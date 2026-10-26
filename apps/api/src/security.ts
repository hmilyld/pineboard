import { ulid } from "@pineboard/shared";
import type { Bindings } from "./env";

export async function hashIp(env: Bindings, ip: string): Promise<string> {
  const data = new TextEncoder().encode(`${env.IP_HASH_SALT}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function consumeRateLimit(
  env: Bindings,
  key: string,
  windowSeconds: number,
  limit: number,
): Promise<{ allowed: boolean; count: number; retryAfter: number }> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / windowSeconds) * windowSeconds;
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1
     RETURNING count`,
  )
    .bind(key, windowStart)
    .first<{ count: number }>();
  const count = Number(row?.count ?? 1);
  return {
    allowed: count <= limit,
    count,
    retryAfter: Math.max(1, windowStart + windowSeconds - now),
  };
}

export type TurnstileResult =
  | { ok: true }
  | { ok: false; code: "captcha_failed" | "captcha_unavailable"; message: string };

/**
 * Siteverify is called only after payload validation and rate limiting. Test
 * secrets (1x/2x) are accepted without action/hostname checks because the
 * Cloudflare test widgets cannot produce a real action/hostname pair.
 */
export async function verifyTurnstile(options: {
  secret: string | null;
  token: string | undefined;
  ip: string;
  action: string;
  expectedHostnames: string[];
}): Promise<TurnstileResult> {
  if (!options.token) {
    return { ok: false, code: "captcha_failed", message: "请完成人机验证" };
  }
  if (!options.secret) {
    return { ok: false, code: "captcha_unavailable", message: "人机验证暂未配置，请联系管理员" };
  }
  const body = new URLSearchParams({
    secret: options.secret,
    response: options.token,
    remoteip: options.ip,
  });
  let response: Response;
  try {
    response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return { ok: false, code: "captcha_unavailable", message: "人机验证暂时不可用，请稍后重试" };
  }
  if (!response.ok) {
    return { ok: false, code: "captcha_unavailable", message: "人机验证暂时不可用，请稍后重试" };
  }
  const result = (await response.json().catch(() => null)) as
    | { success?: boolean; action?: string; hostname?: string; "error-codes"?: string[] }
    | null;
  if (!result || result.success !== true) {
    const codes = result?.["error-codes"] ?? [];
    const unavailable = codes.some((code) => code === "internal-error" || code === "bad-request");
    return unavailable
      ? { ok: false, code: "captcha_unavailable", message: "人机验证暂时不可用，请稍后重试" }
      : { ok: false, code: "captcha_failed", message: "人机验证失败，请重试" };
  }
  const isTestSecret = options.secret.startsWith("1x000") || options.secret.startsWith("2x000");
  if (!isTestSecret) {
    if (result.action !== options.action) {
      return { ok: false, code: "captcha_failed", message: "人机验证动作不匹配" };
    }
    if (!result.hostname || !options.expectedHostnames.includes(result.hostname)) {
      return { ok: false, code: "captcha_failed", message: "人机验证域名不匹配" };
    }
  }
  return { ok: true };
}

export function auditStatement(
  env: Bindings,
  input: {
    actorId: string | null;
    action: string;
    targetType?: string | null;
    targetId?: string | null;
    meta?: Record<string, unknown> | null;
    ipHash?: string | null;
  },
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, meta_json, ip_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    ulid(),
    input.actorId,
    input.action,
    input.targetType ?? null,
    input.targetId ?? null,
    input.meta ? JSON.stringify(input.meta) : null,
    input.ipHash ?? null,
    Math.floor(Date.now() / 1000),
  );
}
