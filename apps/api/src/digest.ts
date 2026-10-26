import { ulid } from "@pineboard/shared";
import { getConfig } from "./config";
import { dispatchEmail, escapeHtml } from "./email";
import type { Bindings } from "./env";
import {
  createUnsubscribeToken,
  getEmailPreferences,
  type NotificationCategory,
} from "./notifications";

type PendingRow = {
  id: string;
  user_id: string;
  type: string;
  topic_id: string;
  post_id: string | null;
  title: string;
  snippet: string;
  created_at: number;
  email: string;
  name: string;
  email_verified: number;
  status: string;
};

const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  topic_reply: "主题回复",
  post_reply: "回复你的回复",
  mention: "提及",
  moderation: "管理通知",
};

function categoryFor(type: string): NotificationCategory | null {
  return type === "topic_reply" || type === "post_reply" || type === "mention" || type === "moderation"
    ? type
    : null;
}

async function sentTodayByUser(db: D1Database): Promise<Map<string, number>> {
  const start = Math.floor(new Date().setUTCHours(0, 0, 0, 0) / 1000);
  const rows = await db.prepare(
    "SELECT user_id, COUNT(*) AS n FROM email_logs WHERE status = 'sent' AND created_at >= ? GROUP BY user_id",
  ).bind(start).all<{ user_id: string | null; n: number }>();
  const map = new Map<string, number>();
  for (const row of rows.results) if (row.user_id) map.set(row.user_id, Number(row.n));
  return map;
}

/**
 * Cron digest: coalesce pending reply notifications per user, respect
 * preferences, unsubscribe/suppression, daily budgets and the per-user cap.
 */
export async function runEmailDigest(
  env: Bindings,
  options: { force?: boolean } = {},
): Promise<{ users: number; sent: number; skipped: number; failed: number; remaining: number }> {
  const loaded = await getConfig(env);
  const config = loaded.config;
  const summary = { users: 0, sent: 0, skipped: 0, failed: 0, remaining: 0 };
  if (!config.mail.enabled) return summary;

  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `UPDATE notifications SET email_batch_key = NULL
      WHERE email_status = 'pending' AND email_batch_key LIKE 'claim:%'
        AND CAST(substr(email_batch_key, 7, instr(substr(email_batch_key, 7), ':') - 1) AS INTEGER) < ?`,
  ).bind(now - 600).run().catch(() => undefined);
  const cutoff = options.force ? now + 1 : now - config.mail.digestWindowMinutes * 60;
  const rows = await env.DB.prepare(
    `SELECT n.id, n.user_id, n.type, n.topic_id, n.post_id, n.title, n.snippet, n.created_at,
            u.email, u.name, u.email_verified, u.status
       FROM notifications n JOIN user u ON u.id = n.user_id
      WHERE n.email_status = 'pending' AND COALESCE(n.email_batch_key, '') != 'direct' AND n.created_at <= ?
      ORDER BY n.created_at ASC LIMIT 500`,
  ).bind(cutoff).all<PendingRow>();

  const grouped = new Map<string, PendingRow[]>();
  for (const row of rows.results) {
    const list = grouped.get(row.user_id) ?? [];
    list.push(row);
    grouped.set(row.user_id, list);
  }

  const sentByUser = await sentTodayByUser(env.DB);
  let globalSent = [...sentByUser.values()].reduce((sum, value) => sum + value, 0);
  if (globalSent >= config.mail.dailyBudget) {
    const pending = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM notifications WHERE email_status = 'pending' AND COALESCE(email_batch_key, '') != 'direct'",
    ).first<{ n: number }>();
    summary.remaining = Number(pending?.n ?? 0);
    return summary;
  }

  for (const [userId, allNotifications] of [...grouped.entries()].slice(0, 20)) {
    summary.users++;
    const claimKey = `claim:${now}:${ulid()}`;
    const candidates = allNotifications.slice(0, 50);
    try {
      const claimPlaceholders = candidates.map(() => "?").join(",");
      const claimed = await env.DB.prepare(
        `UPDATE notifications SET email_batch_key = ?
          WHERE id IN (${claimPlaceholders}) AND email_status = 'pending'
            AND (email_batch_key IS NULL OR email_batch_key NOT LIKE 'claim:%')
          RETURNING id`,
      ).bind(claimKey, ...candidates.map((item) => item.id)).all<{ id: string }>();
      const claimedIds = new Set(claimed.results.map((row) => row.id));
      const notifications = candidates.filter((item) => claimedIds.has(item.id));
      if (!notifications.length) continue;
      const first = notifications[0]!;
    const mark = async (status: "sent" | "skipped" | "failed", ids: string[], batchKey: string | null) => {
      if (!ids.length) return;
      const placeholders = ids.map(() => "?").join(",");
      await env.DB.prepare(
        `UPDATE notifications SET email_status = ?, email_batch_key = ? WHERE id IN (${placeholders})`,
      ).bind(status, batchKey, ...ids).run();
    };
    const release = async (ids: string[]) => {
      if (!ids.length) return;
      const placeholders = ids.map(() => "?").join(",");
      await env.DB.prepare(
        `UPDATE notifications SET email_batch_key = NULL WHERE id IN (${placeholders}) AND email_status = 'pending'`,
      ).bind(...ids).run();
    };

    if (Number(first.email_verified) !== 1 || first.status !== "active") {
      await mark("skipped", notifications.map((n) => n.id), null);
      summary.skipped++;
      continue;
    }
    const suppressed = await env.DB.prepare("SELECT 1 AS ok FROM email_suppressions WHERE email = ?").bind(first.email.toLowerCase()).first();
    if (suppressed) {
      await mark("skipped", notifications.map((n) => n.id), null);
      summary.skipped++;
      continue;
    }
    const prefs = await getEmailPreferences(env.DB, userId);
    const globalEnabled = (category: NotificationCategory): boolean =>
      category === "topic_reply"
        ? config.mail.notifyTopicReply
        : category === "post_reply"
          ? config.mail.notifyPostReply
          : category === "mention"
            ? config.mail.notifyMention
            : config.mail.notifyModeration;
    const eligible = notifications.filter((n) => {
      const category = categoryFor(n.type);
      return category !== null && globalEnabled(category) && (category === "moderation" || prefs[category]);
    });
    if (!eligible.length) {
      await mark("skipped", notifications.map((n) => n.id), null);
      summary.skipped++;
      continue;
    }
    const userSent = sentByUser.get(userId) ?? 0;
    if (userSent >= config.mail.userDailyCap || globalSent >= config.mail.dailyBudget) {
      await release(notifications.map((n) => n.id));
      continue;
    }

    const batch = eligible.slice(0, 10);
    await mark("skipped", notifications.filter((item) => !eligible.includes(item)).map((item) => item.id), null);
    await release(eligible.slice(10).map((item) => item.id));
    const categories = [...new Set(batch.map((n) => categoryFor(n.type)!).filter(Boolean))];
    const unsubscribeLinks: { category: NotificationCategory; url: string }[] = [];
    if (config.mail.includeUnsubscribe) {
      for (const category of categories.filter((item) => item !== "moderation")) {
        const token = await createUnsubscribeToken(env, config, userId, category);
        unsubscribeLinks.push({ category, url: token.url });
      }
    }
    const site = env.SITE_URL.replace(/\/$/, "");
    const items = batch.map((n) => ({
      title: n.title,
      snippet: n.snippet,
      url: `${site}/t/${n.topic_id}`,
      label: CATEGORY_LABEL[categoryFor(n.type)!],
    }));
    const subject = `[${config.site.name}] 你有 ${batch.length} 条新通知`;
    const text = [
      `你好 ${first.name}，`,
      "",
      ...items.map((item) => `- [${item.label}] ${item.title}\n  ${item.snippet}\n  ${item.url}`),
      "",
      "在站内查看：",
      `${site}/notifications`,
      "",
      ...unsubscribeLinks.map((link) => `退订「${CATEGORY_LABEL[link.category]}」邮件：${link.url}`),
    ].join("\n");
    const html = `<p>你好 ${escapeHtml(first.name)}，</p><p>你有 ${batch.length} 条新通知：</p><ul>${items
      .map((item) => `<li><strong>${escapeHtml(item.label)}</strong>：<a href="${escapeHtml(item.url)}">${escapeHtml(item.title)}</a><br><span>${escapeHtml(item.snippet)}</span></li>`)
      .join("")}</ul><p><a href="${escapeHtml(`${site}/notifications`)}">在站内查看全部通知</a></p><p style="font-size:12px;color:#666">${unsubscribeLinks
      .map((link) => `<a href="${escapeHtml(link.url)}">退订「${escapeHtml(CATEGORY_LABEL[link.category])}」</a>`)
      .join(" · ")}</p>`;

    const result = await dispatchEmail(env, config, {
      to: first.email,
      userId,
      category: "digest",
      template: "digest",
      subject,
      html,
      text,
      url: `${site}/notifications`,
      unsubscribeUrl: unsubscribeLinks[0]?.url.replace("/unsubscribe?", "/api/unsubscribe?"),
    });
    const status = result.status === "sent" ? "sent" : result.status === "skipped" ? "skipped" : "failed";
    await mark(status, batch.map((n) => n.id), result.logId);
    if (status === "sent") {
      summary.sent++;
      globalSent++;
      sentByUser.set(userId, userSent + 1);
    } else if (status === "skipped") summary.skipped++;
    else summary.failed++;
    } catch (error) {
      console.error(JSON.stringify({
        level: "error",
        job: "digest",
        userId,
        message: error instanceof Error ? error.message : String(error),
      }));
      await env.DB.prepare(
        "UPDATE notifications SET email_batch_key = NULL WHERE email_batch_key = ? AND email_status = 'pending'",
      ).bind(claimKey).run().catch(() => undefined);
      summary.failed++;
    }
  }
  const pending = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM notifications WHERE email_status = 'pending' AND COALESCE(email_batch_key, '') != 'direct'",
  ).first<{ n: number }>();
  summary.remaining = Number(pending?.n ?? 0);
  return summary;
}

export async function recordResendBounce(env: Bindings, email: string, reason: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO email_suppressions (email, reason, created_at) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET reason = excluded.reason, created_at = excluded.created_at")
      .bind(email.toLowerCase(), reason, now),
    env.DB.prepare("UPDATE email_logs SET status = 'failed', error_code = ?, error_message = ? WHERE to_email = ? AND status IN ('queued','sent')")
      .bind(reason, reason, email.toLowerCase()),
    env.DB.prepare(`INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, meta_json, ip_hash, created_at)
      VALUES (?, NULL, 'email.suppress', 'email', ?, ?, NULL, ?)`)
      .bind(ulid(), email.toLowerCase(), JSON.stringify({ reason }), now),
  ]);
}
