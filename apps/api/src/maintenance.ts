import { ok } from "@pineboard/shared";
import { Hono } from "hono";
import { runAccountCleanup } from "./account";
import { COUNTER_RECONCILE_SQL } from "./counter-sync";
import type { AppEnv, Bindings } from "./env";
import { requireAdmin } from "./middleware/guards";
import { markMaintenanceRun } from "./jobs";
import { cleanupOrphanUploads } from "./uploads";
import { getConfig } from "./config";

export async function runDailyMaintenance(env: Bindings): Promise<{
  removed: Record<string, number>;
  reconciled: boolean;
  anonymized: number;
}> {
  const now = Math.floor(Date.now() / 1000);
  const dayAgo = now - 86_400;
  const weekAgo = now - 7 * 86_400;
  const ninetyDaysAgo = now - 90 * 86_400;
  const deletes = await env.DB.batch([
    env.DB.prepare("DELETE FROM session WHERE expires_at < ?").bind(now),
    env.DB.prepare("DELETE FROM verification WHERE expires_at < ?").bind(now),
    env.DB.prepare('DELETE FROM "rateLimit" WHERE last_request < ?').bind(now * 1000 - 86_400_000),
    env.DB.prepare("DELETE FROM rate_limits WHERE window_start < ?").bind(dayAgo),
    env.DB.prepare("DELETE FROM dev_email_outbox WHERE created_at < ?").bind(weekAgo),
    env.DB.prepare("DELETE FROM notifications WHERE read_at IS NOT NULL AND read_at < ?").bind(ninetyDaysAgo),
    env.DB.prepare("DELETE FROM email_logs WHERE created_at < ?").bind(now - 180 * 86_400),
    env.DB.prepare("DELETE FROM audit_logs WHERE created_at < ?").bind(now - 365 * 86_400),
    env.DB.prepare("DELETE FROM email_unsubscribe_tokens WHERE expires_at < ? OR used_at IS NOT NULL").bind(now),
    env.DB.prepare(
      "UPDATE notifications SET email_status = 'pending', email_batch_key = NULL WHERE email_status = 'pending' AND email_batch_key = 'direct' AND created_at < ?",
    ).bind(now - 3600),
  ]);
  const removed = {
    sessions: Number(deletes[0]?.meta.changes ?? 0),
    verifications: Number(deletes[1]?.meta.changes ?? 0),
    rateLimits: Number(deletes[2]?.meta.changes ?? 0),
    windowLimits: Number(deletes[3]?.meta.changes ?? 0),
    devOutbox: Number(deletes[4]?.meta.changes ?? 0),
    notifications: Number(deletes[5]?.meta.changes ?? 0),
    emailLogs: Number(deletes[6]?.meta.changes ?? 0),
    auditLogs: Number(deletes[7]?.meta.changes ?? 0),
    unsubscribeTokens: Number(deletes[8]?.meta.changes ?? 0),
    stuckDirectEmails: Number(deletes[9]?.meta.changes ?? 0),
  };
  // Counter reconciliation is drift-only (see counter-sync.ts): a full-table
  // UPDATE would rewrite every row once a day, and the write is what the D1
  // free tier caps.
  await env.DB.batch(COUNTER_RECONCILE_SQL.map((sql) => env.DB.prepare(sql)));
  const account = await runAccountCleanup(env);
  const config = await getConfig(env);
  let uploads = 0;
  try {
    uploads = await cleanupOrphanUploads(env, config.config.upload.orphanTtlHours);
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        job: "uploads.cleanup",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
  return { removed: { ...removed, uploads }, reconciled: true, anonymized: account.anonymized };
}

export const maintenanceRoutes = new Hono<AppEnv>();

maintenanceRoutes.post("/api/admin/maintenance/daily", requireAdmin, async (c) => {
  const result = await runDailyMaintenance(c.env);
  await markMaintenanceRun(c.env, "daily");
  return c.json(ok(result));
});
