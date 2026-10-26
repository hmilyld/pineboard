import { DERIVED_PASSWORD_RE, fail } from "@pineboard/shared";
import type { MiddlewareHandler } from "hono";
import { getSecurityConfig } from "../config";
import { getEffectiveIntegrations } from "../integrations";
import type { AppEnv } from "../env";
import { consumeRateLimit, verifyTurnstile } from "../security";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-z0-9_-]{3,20}$/;
const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "moderator",
  "root",
  "system",
  "support",
  "forum",
  "official",
  "help",
  "api",
  "me",
  "new",
  "login",
  "register",
  "settings",
  "notifications",
]);

function clientIp(c: { req: { header(name: string): string | undefined } }): string {
  return c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

function fieldError(message: string, field: string): ReturnType<typeof fail> {
  return fail("validation_error", message, { [field]: [message] });
}

/**
 * Turnstile order (AGENTS.md #6):
 * payload validation -> permission/email verification -> rate limit -> siteverify -> write.
 * The write itself is performed by Better Auth after this middleware calls next().
 */
export const signupGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const loaded = await getSecurityConfig(c.env);
  const config = loaded.config;
  c.set("config", config);

  let body: Record<string, unknown>;
  try {
    body = (await c.req.raw.clone().json()) as Record<string, unknown>;
  } catch {
    c.header("cache-control", "no-store");
    return c.json(fail("validation_error", "请求体必须是 JSON"), 400);
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (name.length < 1 || name.length > 50) {
    c.header("cache-control", "no-store");
    return c.json(fieldError("昵称长度需在 1–50 字之间", "name"), 400);
  }
  if (!EMAIL_RE.test(email) || email.length > 254) {
    c.header("cache-control", "no-store");
    return c.json(fieldError("邮箱格式不正确", "email"), 400);
  }
  if (!USERNAME_RE.test(username)) {
    c.header("cache-control", "no-store");
    return c.json(fieldError("用户名需为 3–20 位小写字母、数字、下划线或短横线", "username"), 400);
  }
  if (username.length < config.account.usernameMin || username.length > config.account.usernameMax) {
    c.header("cache-control", "no-store");
    return c.json(fieldError(`用户名长度需在 ${config.account.usernameMin}–${config.account.usernameMax} 位之间`, "username"), 400);
  }
  if (RESERVED_USERNAMES.has(username)) {
    c.header("cache-control", "no-store");
    return c.json(fieldError("该用户名不可用", "username"), 400);
  }
  if (!DERIVED_PASSWORD_RE.test(password)) {
    c.header("cache-control", "no-store");
    return c.json(fieldError("密码必须由浏览器端派生", "password"), 400);
  }
  if (!config.account.registrationOpen) {
    c.header("cache-control", "no-store");
    return c.json(fail("forbidden", "当前未开放注册"), 403);
  }

  const ip = clientIp(c);
  const ipHash = await crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(`${c.env.IP_HASH_SALT}:${ip}`))
    .then((digest) => [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""));
  const limit = await consumeRateLimit(c.env, `signup:${ipHash}`, 3600, config.security.signupPerHour);
  if (!limit.allowed) {
    c.header("retry-after", String(limit.retryAfter));
    c.header("cache-control", "no-store");
    return c.json(fail("rate_limited", "注册过于频繁，请稍后再试"), 429);
  }

  if (config.feature.turnstile) {
    const token = c.req.header("x-turnstile-token") ?? c.req.header("cf-turnstile-response");
    const expectedHostnames = [
      new URL(config.site.url).hostname,
      new URL(c.env.SITE_URL).hostname,
    ].filter(Boolean);
    const integration = await getEffectiveIntegrations(c.env);
    if (!integration.cloudflare.turnstileSiteKey) {
      await next();
      return;
    }
    const result = await verifyTurnstile({
      secret: integration.secrets.turnstileSecret,
      token,
      ip,
      action: "signup",
      expectedHostnames: [...new Set(expectedHostnames)],
    });
    if (!result.ok) {
      c.header("cache-control", "no-store");
      return c.json(fail(result.code, result.message), result.code === "captcha_unavailable" ? 503 : 400);
    }
  }

  await next();
};

/** Reject raw passwords on reset/change before Better Auth hashes them. */
export const derivedPasswordGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.raw.clone().json()) as Record<string, unknown>;
  } catch {
    c.header("cache-control", "no-store");
    return c.json(fail("validation_error", "请求体必须是 JSON"), 400);
  }
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  if (!DERIVED_PASSWORD_RE.test(newPassword)) {
    c.header("cache-control", "no-store");
    return c.json(fieldError("密码必须由浏览器端派生", "newPassword"), 400);
  }
  await next();
};
