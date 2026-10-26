import { ulid, type AppConfig } from "@pineboard/shared";
import type { Bindings } from "./env";
import { getEffectiveIntegrations } from "./integrations";

export type EmailCategory = "verification" | "reset" | "mention" | "moderation" | "digest";
export type EmailInput = {
  to: string;
  userId?: string | null;
  category: EmailCategory;
  template: string;
  subject: string;
  html: string;
  text: string;
  token?: string;
  url?: string;
  unsubscribeUrl?: string;
};

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

async function logEmail(
  env: Bindings,
  id: string,
  status: "queued" | "sent" | "failed" | "skipped",
  extra: { providerId?: string; errorCode?: string; errorMessage?: string; attempts?: number } = {},
): Promise<void> {
  await env.DB.prepare(
    `UPDATE email_logs SET status = ?, provider_id = COALESCE(?, provider_id),
       error_code = ?, error_message = ?, attempts = COALESCE(?, attempts),
       sent_at = CASE WHEN ? = 'sent' THEN ? ELSE sent_at END
     WHERE id = ?`,
  )
    .bind(
      status,
      extra.providerId ?? null,
      extra.errorCode ?? null,
      extra.errorMessage ?? null,
      extra.attempts ?? null,
      status,
      nowSeconds(),
      id,
    )
    .run();
}

/**
 * Called from auth hooks via ctx.waitUntil(); never awaited on the request path.
 * With no Resend key (local/staging tests) it records the message in
 * dev_email_outbox so tests can retrieve verification/reset links.
 */
export async function dispatchEmail(
  env: Bindings,
  config: AppConfig,
  input: EmailInput,
): Promise<{ status: "sent" | "failed" | "skipped"; logId: string }> {
  const id = ulid();
  const createdAt = nowSeconds();
  let attempts = 0;
  try {
    await env.DB.prepare(
      `INSERT INTO email_logs (id, user_id, to_email, category, template, status, attempts, created_at)
       VALUES (?, ?, ?, ?, ?, 'queued', 0, ?)`,
    )
      .bind(id, input.userId ?? null, input.to, input.category, input.template, createdAt)
      .run();

    const suppressed = await env.DB.prepare("SELECT 1 AS ok FROM email_suppressions WHERE email = ?")
      .bind(input.to.toLowerCase())
      .first();
    if (suppressed) {
      await logEmail(env, id, "skipped", { providerId: "suppressed", attempts: 0 });
      return { status: "skipped", logId: id };
    }

    const integration = await getEffectiveIntegrations(env);
    const resendApiKey = integration.secrets.resendApiKey;
    const transport = env.EMAIL_TRANSPORT ?? (resendApiKey ? "resend" : "log");

    if (!config.mail.enabled || transport === "log" || !resendApiKey) {
      if (env.ENVIRONMENT !== "production") {
        await env.DB.prepare(
          `INSERT INTO dev_email_outbox (id, to_email, category, payload_json, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
          .bind(
            ulid(),
            input.to,
            input.category,
            JSON.stringify({
              subject: input.subject,
              html: input.html,
              text: input.text,
              token: input.token ?? null,
              url: input.url ?? null,
            }),
            createdAt,
          )
          .run();
      }
      await logEmail(env, id, "skipped", { providerId: "log", attempts: 0 });
      return { status: "skipped", logId: id };
    }

    const payload = {
      from: `${config.mail.fromName} <${config.mail.fromAddress}>`,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
      reply_to: config.mail.replyTo ?? undefined,
      headers: input.unsubscribeUrl
        ? {
            "List-Unsubscribe": `<${input.unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          }
        : undefined,
    };
    let response: Response | null = null;
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      attempts = attempt;
      try {
        response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            authorization: `Bearer ${resendApiKey}`,
            "content-type": "application/json",
            "idempotency-key": id,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(8000),
        });
        if (response.ok || response.status < 500) break;
      } catch (error) {
        lastError = error;
      }
      if (attempt === 1) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!response) throw lastError ?? new Error("email transport unavailable");
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      await logEmail(env, id, "failed", {
        errorCode: `http_${response.status}`,
        errorMessage: detail,
        attempts,
      });
      return { status: "failed", logId: id };
    }
    const body = (await response.json().catch(() => ({}))) as { id?: string };
    await logEmail(env, id, "sent", { providerId: body.id ?? "resend", attempts });
    return { status: "sent", logId: id };
  } catch (error) {
    try {
      await logEmail(env, id, "failed", {
        errorCode: "send_error",
        errorMessage: error instanceof Error ? error.message.slice(0, 500) : "unknown",
        attempts: Math.max(1, attempts),
      });
    } catch {
      // Email logging must never escape waitUntil.
    }
    return { status: "failed", logId: id };
  }
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function verificationEmail(name: string, url: string, ttlMinutes = 60): { subject: string; html: string; text: string } {
  const safeName = escapeHtml(name);
  return {
    subject: "验证你的邮箱",
    text: `你好 ${name}，请在 ${ttlMinutes} 分钟内打开以下链接验证邮箱：\n${url}\n如果不是你本人操作，请忽略此邮件。`,
    html: `<p>你好 ${safeName}，</p><p>请在 ${ttlMinutes} 分钟内点击下面的按钮验证邮箱：</p><p><a href="${escapeHtml(url)}">验证邮箱</a></p><p>如果不是你本人操作，请忽略此邮件。</p>`,
  };
}

export function mentionEmail(
  name: string,
  actor: string,
  topicTitle: string,
  snippet: string,
  url: string,
  preferencesUrl: string,
): { subject: string; html: string; text: string } {
  const safeName = escapeHtml(name);
  const safeActor = escapeHtml(actor);
  const safeTitle = escapeHtml(topicTitle);
  const safeSnippet = escapeHtml(snippet);
  return {
    subject: `${actor} 在「${topicTitle}」提到了你`.replace(/[\r\n]+/g, " "),
    text: `你好 ${name}，\n\n${actor} 在「${topicTitle}」提到了你：\n\n${snippet}\n\n打开主题：${url}\n\n你可以在个人设置中关闭提及邮件：${preferencesUrl}`,
    html: `<p>你好 ${safeName}，</p><p><strong>${safeActor}</strong> 在「${safeTitle}」提到了你：</p><blockquote>${safeSnippet}</blockquote><p><a href="${escapeHtml(url)}">打开主题</a></p><p style="font-size:12px;color:#666">你可以在<a href="${escapeHtml(preferencesUrl)}">个人设置</a>中关闭提及邮件。</p>`,
  };
}

export function resetPasswordEmail(name: string, url: string, ttlMinutes = 30): { subject: string; html: string; text: string } {
  const safeName = escapeHtml(name);
  return {
    subject: "重置密码",
    text: `你好 ${name}，请在 ${ttlMinutes} 分钟内打开以下链接重置密码：\n${url}\n如果不是你本人操作，请忽略此邮件。`,
    html: `<p>你好 ${safeName}，</p><p>请在 ${ttlMinutes} 分钟内点击下面的按钮重置密码：</p><p><a href="${escapeHtml(url)}">重置密码</a></p><p>如果不是你本人操作，请忽略此邮件。</p>`,
  };
}
