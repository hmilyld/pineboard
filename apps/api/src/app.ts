import { fail, healthSchema, ok, timingSafeEqual, type Health } from "@pineboard/shared";
import { Hono } from "hono";
import { createAuth } from "./auth";
import type { AppEnv } from "./env";
import { derivedPasswordGuard, signupGuard } from "./middleware/auth-guards";
import { loadConfig } from "./middleware/config";
import { attachSession } from "./middleware/session";
import { requestContext } from "./middleware/request-context";
import { accountRoutes } from "./account";
import { getSecurityConfig } from "./config";
import { getEffectiveIntegrations } from "./integrations";
import { registerDocRoutes } from "./docs";
import { maintenanceRoutes } from "./maintenance";
import { adminRoutes } from "./routes/admin";
import { adminContentRoutes } from "./routes/admin-content";
import { adminUserRoutes } from "./routes/admin-users";
import { adminIntegrationRoutes } from "./routes/admin-integrations";
import { emailAdminRoutes } from "./email-admin";
import { moderationRoutes } from "./moderation";
import { reportRoutes } from "./reports";
import { searchRoutes } from "./search";
import { notificationRoutes } from "./notifications";
import { forumRoutes } from "./forum";
import { userRoutes } from "./users";
import { meRoutes } from "./routes/me";
import { siteRoutes } from "./routes/site";
import { uploadRoutes } from "./uploads";

export const app = new Hono<AppEnv>();

let r2Health: { ok: boolean; expiresAt: number } | null = null;

app.use("*", requestContext);

// Keep health independent from config/session middleware: it is the cheapest
// route used for uptime checks and deploy smoke tests.
app.get("/api/health", async (c) => {
  const started = performance.now();
  const [pingResult, settingsResult] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT 1 AS ok"),
    c.env.DB.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM settings"),
  ]);
  const ping = pingResult?.results[0] as { ok?: number } | undefined;
  const settings = settingsResult?.results[0] as { version?: number } | undefined;
  const dbOk = ping?.ok === 1;
  const configVersion = String(settings?.version ?? 0);

  if (!r2Health || r2Health.expiresAt <= Date.now()) {
    try {
      await c.env.BUCKET.head("__health__");
      r2Health = { ok: true, expiresAt: Date.now() + 30_000 };
    } catch {
      r2Health = { ok: false, expiresAt: Date.now() + 30_000 };
    }
  }
  const r2Ok = r2Health.ok;

  const integration = await getEffectiveIntegrations(c.env);
  const data: Health = {
    status: "ok",
    version: c.env.CF_VERSION_METADATA?.id?.slice(0, 12) ?? "dev",
    environment: c.env.ENVIRONMENT,
    db: dbOk,
    r2: r2Ok,
    now: Math.floor(Date.now() / 1000),
    configVersion,
    turnstileConfigured: Boolean(
      integration.cloudflare.turnstileSiteKey && integration.secrets.turnstileSecret,
    ),
  };
  healthSchema.parse(data);
  c.header("cache-control", "no-store");
  c.header("server-timing", `total;dur=${(performance.now() - started).toFixed(2)}`);
  return c.json(ok(data));
});

// Local-only test reset; never registered in staging/production.
app.post("/api/dev/reset", async (c) => {
  const token = c.env.DEV_RESET_TOKEN;
  const supplied = c.req.header("x-dev-reset-token");
  if (c.env.ENVIRONMENT !== "development" || !token || !supplied || !timingSafeEqual(token, supplied)) {
    c.header("cache-control", "no-store");
    return c.json(fail("not_found", "接口不存在"), 404);
  }
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM reports"),
    c.env.DB.prepare("DELETE FROM notifications"),
    c.env.DB.prepare("DELETE FROM notification_preferences"),
    c.env.DB.prepare("DELETE FROM email_unsubscribe_tokens"),
    c.env.DB.prepare("DELETE FROM email_suppressions"),
    c.env.DB.prepare("DELETE FROM post_revisions"),
    c.env.DB.prepare("DELETE FROM bookmarks"),
    c.env.DB.prepare("DELETE FROM post_likes"),
    c.env.DB.prepare("DELETE FROM posts"),
    c.env.DB.prepare("DELETE FROM topic_tags"),
    c.env.DB.prepare("DELETE FROM topics"),
    c.env.DB.prepare("UPDATE tags SET usage_count = 0"),
    c.env.DB.prepare("DELETE FROM session"),
    c.env.DB.prepare("DELETE FROM account"),
    c.env.DB.prepare("DELETE FROM verification"),
    c.env.DB.prepare('DELETE FROM "rateLimit"'),
    c.env.DB.prepare("DELETE FROM rate_limits"),
    c.env.DB.prepare("DELETE FROM dev_email_outbox"),
    c.env.DB.prepare('DELETE FROM "user"'),
    c.env.DB.prepare("DELETE FROM audit_logs"),
  ]);
  c.header("cache-control", "no-store");
  return c.json({ ok: true, data: { reset: true } });
});

// Same-origin guard for browser writes. Non-browser/server callbacks without an
// Origin header (Resend webhook, health checks) are allowed; a mismatched
// Origin is rejected before auth/config work.
app.use("/api/*", async (c, next) => {
  if (c.req.method === "GET" || c.req.method === "HEAD" || c.req.method === "OPTIONS") return next();
  const origin = c.req.header("origin");
  if (origin) {
    const allowed = new Set([
      new URL(c.req.url).origin,
      c.env.SITE_URL.replace(/\/$/, ""),
      ...(c.env.ENVIRONMENT === "development"
        ? ["http://localhost:5173", "http://localhost:5174", "http://localhost:4173"]
        : []),
    ]);
    if (!allowed.has(origin)) {
      c.header("cache-control", "no-store");
      return c.json(fail("forbidden", "跨站请求被拒绝"), 403);
    }
  }
  await next();
});

app.use("/api/*", loadConfig);
app.use("/api/*", attachSession);
app.use("/api/*", async (c, next) => {
  const security = await getSecurityConfig(c.env);
  const config = security.config;
  if (!config.feature.guestRead && !c.get("user") && (c.req.method === "GET" || c.req.method === "HEAD")) {
    const path = c.req.path;
    const allowed = path === "/api/health" || path === "/api/site" || path.startsWith("/api/auth/") || path.startsWith("/api/webhooks/");
    if (!allowed) {
      c.header("cache-control", "no-store");
      return c.json(fail("auth_required", "请先登录"), 401);
    }
  }
  if (!config.maintenance.enabled) return next();
  const path = c.req.path;
  const allowed = path === "/api/health" || path === "/api/site" || path.startsWith("/api/auth/") || path.startsWith("/api/webhooks/");
  const adminBypass = config.maintenance.allowAdmin && c.get("user")?.role === "admin";
  if (allowed || adminBypass) return next();
  c.header("cache-control", "no-store");
  return c.json(fail("maintenance", config.maintenance.message), 503);
});

// Turnstile must run before Better Auth writes the user.
app.use("/api/auth/sign-up/email", signupGuard);
app.use("/api/auth/reset-password", derivedPasswordGuard);
app.use("/api/auth/change-password", derivedPasswordGuard);

app.route("/", siteRoutes);
app.route("/", uploadRoutes);
app.route("/", forumRoutes);
app.route("/", userRoutes);
app.route("/", moderationRoutes);
app.route("/", emailAdminRoutes);
app.route("/", notificationRoutes);
app.route("/", searchRoutes);
app.route("/", reportRoutes);
app.route("/", accountRoutes);
app.route("/", maintenanceRoutes);

registerDocRoutes(app);
app.route("/", meRoutes);
app.route("/", adminRoutes);
app.route("/", adminContentRoutes);
app.route("/", adminUserRoutes);
app.route("/", adminIntegrationRoutes);

app.on(["GET", "POST"], "/api/auth/*", async (c) => {
  const auth = createAuth(c.env, c.executionCtx, c.get("config"));
  return auth.handler(c.req.raw);
});

app.notFound((c) => {
  c.header("cache-control", "no-store");
  return c.json(fail("not_found", "接口不存在"), 404);
});

app.onError((error, c) => {
  const requestId = c.get("requestId");
  console.error(
    JSON.stringify({
      level: "error",
      requestId,
      path: c.req.path,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack?.split("\n").slice(0, 4).join("\n") : undefined,
    }),
  );
  c.header("cache-control", "no-store");
  return c.json(fail("internal_error", "服务器内部错误"), 500);
});
