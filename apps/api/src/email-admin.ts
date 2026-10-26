import { fail, ok } from "@pineboard/shared";
import { Hono } from "hono";
import { runEmailDigest, recordResendBounce } from "./digest";
import type { AppEnv } from "./env";
import { requireAdmin } from "./middleware/guards";
import { markMaintenanceRun } from "./jobs";
import { getEffectiveIntegrations } from "./integrations";

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function verifySvix(env: AppEnv["Bindings"], headers: Headers, body: string): Promise<boolean> {
  const secret = (await getEffectiveIntegrations(env)).secrets.resendWebhookSecret;
  if (!secret) return env.ENVIRONMENT === "development";
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signature = headers.get("svix-signature");
  if (!id || !timestamp || !signature) return false;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(Date.now() / 1000 - seconds) > 300) return false;
  const rawSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const key = await crypto.subtle.importKey("raw", base64ToBytes(rawSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`));
  const expected = btoa(String.fromCharCode(...new Uint8Array(signed)));
  return signature.split(" ").some((part) => {
    const value = part.includes(",") ? part.split(",")[1] : part;
    return value === expected;
  });
}

export const emailAdminRoutes = new Hono<AppEnv>();

emailAdminRoutes.post("/api/admin/emails/digest", requireAdmin, async (c) => {
  const summary = await runEmailDigest(c.env, { force: true });
  await markMaintenanceRun(c.env, "digest");
  return c.json(ok(summary));
});

emailAdminRoutes.get("/api/admin/emails", requireAdmin, async (c) => {
  const rawLimit = Number(c.req.query("limit") ?? 50);
  const limit = Number.isFinite(rawLimit) ? Math.min(200, Math.max(1, Math.floor(rawLimit))) : 50;
  const rows = await c.env.DB.prepare(
    `SELECT id, user_id, to_email, category, template, status, provider_id, error_code, error_message, attempts, created_at, sent_at
       FROM email_logs ORDER BY created_at DESC LIMIT ?`,
  ).bind(limit).all<Record<string, unknown>>();
  return c.json(ok(rows.results.map((row) => ({
    id: String(row.id),
    userId: (row.user_id as string | null) ?? null,
    toEmail: String(row.to_email),
    category: String(row.category),
    template: String(row.template),
    status: String(row.status),
    providerId: (row.provider_id as string | null) ?? null,
    errorCode: (row.error_code as string | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
    attempts: Number(row.attempts ?? 0),
    createdAt: Number(row.created_at),
    sentAt: row.sent_at == null ? null : Number(row.sent_at),
  }))));
});

emailAdminRoutes.post("/api/webhooks/resend", async (c) => {
  const raw = await c.req.text();
  if (!(await verifySvix(c.env, c.req.raw.headers, raw))) {
    return c.json(fail("forbidden", "webhook 签名无效"), 401);
  }
  let event: { type?: string; data?: { to?: string[] | string } };
  try {
    event = JSON.parse(raw) as typeof event;
  } catch {
    return c.json(fail("validation_error", "webhook 载荷无效"), 400);
  }
  if (event.type === "email.bounced" || event.type === "email.complained") {
    const recipients = Array.isArray(event.data?.to) ? event.data.to : event.data?.to ? [event.data.to] : [];
    for (const email of recipients) await recordResendBounce(c.env, email, event.type);
  }
  return c.json(ok({ received: true }));
});
