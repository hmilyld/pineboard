import { fail, ok, type AdminOverview, type AppConfig, type DeepPartial } from "@pineboard/shared";
import { Hono } from "hono";
import { getConfig, readConfigVersion, writeConfigPatch } from "../config";
import type { AppEnv } from "../env";
import { requireAdmin } from "../middleware/guards";
import { siteStats, startOfDaySeconds } from "../stats";

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.get("/api/admin/overview", requireAdmin, async (c) => {
  const loaded = await getConfig(c.env);
  const stats = await siteStats(c.env.DB, loaded.config.site.timezone);
  const weekAgo = Math.floor(Date.now() / 1000) - 7 * 86_400;
  const counts = await c.env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM reports WHERE status = 'pending') AS pending_reports,
       (SELECT COUNT(*) FROM user WHERE status = 'active' AND created_at >= ?) AS new_members,
       (SELECT COUNT(*) FROM email_logs WHERE status = 'failed' AND created_at >= ?) AS email_failures`,
  ).bind(weekAgo, weekAgo).first<{ pending_reports: number; new_members: number; email_failures: number }>();

  const reportRows = await c.env.DB.prepare(
    `SELECT r.id, r.reason_code, r.target_type, r.target_id, r.created_at, u.name AS reporter_name
       FROM reports r JOIN user u ON u.id = r.reporter_id
      WHERE r.status = 'pending' ORDER BY r.created_at ASC LIMIT 8`,
  ).all<Record<string, unknown>>();
  const pendingReportItems = [];
  for (const row of reportRows.results) {
    let targetTitle = "内容已不存在";
    if (row.target_type === "topic") {
      const target = await c.env.DB.prepare(
        "SELECT title FROM posts WHERE topic_id = ? AND is_first = 1 LIMIT 1",
      ).bind(row.target_id).first<{ title: string }>();
      if (target) targetTitle = target.title;
    } else {
      const target = await c.env.DB.prepare(
        `SELECT (SELECT fp.title FROM posts fp WHERE fp.topic_id = p.topic_id AND fp.is_first = 1 LIMIT 1) AS title
           FROM posts p WHERE p.id = ?`,
      ).bind(row.target_id).first<{ title: string | null }>();
      if (target?.title) targetTitle = target.title;
    }
    pendingReportItems.push({
      id: String(row.id),
      reasonCode: String(row.reason_code),
      targetType: String(row.target_type),
      targetId: String(row.target_id),
      targetTitle,
      reporterName: String(row.reporter_name),
      createdAt: Number(row.created_at),
    });
  }
  const jobRows = await c.env.DB.prepare(
    "SELECT key, value_json FROM settings WHERE key LIKE 'maintenance.last.%'",
  ).all<{ key: string; value_json: string }>();
  const jobs: Record<string, number | null> = {};
  for (const row of jobRows.results) {
    const job = row.key.replace("maintenance.last.", "");
    try {
      const parsed = JSON.parse(row.value_json) as unknown;
      jobs[job] = typeof parsed === "number" && Number.isFinite(parsed) ? Math.floor(parsed) : null;
    } catch {
      jobs[job] = null;
    }
  }
  const deployRaw = c.env.CF_VERSION_METADATA?.timestamp;
  const lastDeployAt = deployRaw && Number.isFinite(Date.parse(deployRaw)) ? Math.floor(Date.parse(deployRaw) / 1000) : null;
  const data: AdminOverview = {
    todayPosts: stats.todayPosts,
    pendingReports: Number(counts?.pending_reports ?? 0),
    newMembersWeek: Number(counts?.new_members ?? 0),
    emailFailures: Number(counts?.email_failures ?? 0),
    configVersion: String(loaded.version),
    lastDeployAt,
    jobs,
    pendingReportItems,
  };
  c.header("cache-control", "no-store");
  return c.json(ok(data));
});

adminRoutes.get("/api/admin/settings", requireAdmin, async (c) => {
  const [loaded, version] = await Promise.all([getConfig(c.env), readConfigVersion(c.env)]);
  c.header("cache-control", "no-store");
  return c.json(ok({ config: loaded.config, version: String(version), errors: loaded.errors }));
});

adminRoutes.patch("/api/admin/settings", requireAdmin, async (c) => {
  const user = c.get("user")!;
  let body: { version?: string | number; patch?: DeepPartial<AppConfig> };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    c.header("cache-control", "no-store");
    return c.json(fail("validation_error", "请求体必须是 JSON"), 400);
  }
  const expected = Number(body?.version);
  if (!body?.patch || !Number.isFinite(expected) || expected < 0) {
    c.header("cache-control", "no-store");
    return c.json(fail("validation_error", "缺少配置版本号 patch/version"), 400);
  }
  try {
    const updated = await writeConfigPatch(c.env, body.patch, user.id, expected);
    c.header("cache-control", "no-store");
    return c.json(ok({ config: updated.config, version: String(updated.version) }));
  } catch (error) {
    if (error instanceof Error && error.name === "ConfigValidationError") {
      c.header("cache-control", "no-store");
      return c.json(fail("validation_error", error.message), 400);
    }
    if (error instanceof Error && error.name === "ConfigVersionConflict") {
      c.header("cache-control", "no-store");
      return c.json(fail("version_conflict", "设置已被他人修改，请刷新后重试"), 409);
    }
    throw error;
  }
});
