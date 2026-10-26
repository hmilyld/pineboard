import { deleteAccountSchema, fail, hmacB64, ok, timingSafeEqual, ulid } from "@pineboard/shared";
import { Hono } from "hono";
import { getConfig } from "./config";
import type { AppEnv, Bindings, SessionUser } from "./env";
import { requireActive, requireAdmin, requireAuth } from "./middleware/guards";
import { markMaintenanceRun } from "./jobs";
import { consumeRateLimit } from "./security";

async function exportPayload(db: D1Database, user: SessionUser) {
  const topics = await db.prepare(
    `SELECT t.id, t.status, t.created_at, fp.title, fp.content_md
       FROM topics t JOIN posts fp ON fp.topic_id = t.id AND fp.is_first = 1
      WHERE t.author_id = ? ORDER BY t.created_at`,
  ).bind(user.id).all();
  const posts = await db.prepare(
    "SELECT id, topic_id, floor, content_md, status, created_at FROM posts WHERE author_id = ? ORDER BY created_at",
  ).bind(user.id).all();
  const bookmarks = await db.prepare("SELECT topic_id, created_at FROM bookmarks WHERE user_id = ?").bind(user.id).all();
  return {
    version: 1,
    exportedAt: Math.floor(Date.now() / 1000),
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      bio: user.bio,
      timezone: user.timezone,
      createdAt: Math.floor(user.createdAt.getTime() / 1000),
    },
    topics: topics.results,
    posts: posts.results,
    bookmarks: bookmarks.results,
  };
}

export async function runAccountCleanup(env: Bindings): Promise<{ anonymized: number }> {
  const config = await getConfig(env);
  const cutoff = Math.floor(Date.now() / 1000) - config.config.account.deletionGraceDays * 86_400;
  const rows = await env.DB.prepare(
    "SELECT id, email FROM user WHERE status = 'deleting' AND deleted_at IS NOT NULL AND deleted_at <= ? LIMIT 50",
  ).bind(cutoff).all<{ id: string; email: string }>();
  let anonymized = 0;
  for (const row of rows.results) {
    const now = Math.floor(Date.now() / 1000);
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE user SET name = '已注销用户', email = ?, username = NULL, image = NULL, avatar_key = NULL,
                bio = NULL, timezone = NULL, status = 'deleted', updated_at = ? WHERE id = ?`,
      ).bind(`deleted+${row.id}@invalid.local`, now, row.id),
      env.DB.prepare("DELETE FROM session WHERE user_id = ?").bind(row.id),
      env.DB.prepare("DELETE FROM account WHERE user_id = ?").bind(row.id),
      env.DB.prepare("DELETE FROM bookmarks WHERE user_id = ?").bind(row.id),
      env.DB.prepare("DELETE FROM notifications WHERE user_id = ?").bind(row.id),
      env.DB.prepare("DELETE FROM notification_preferences WHERE user_id = ?").bind(row.id),
      env.DB.prepare("DELETE FROM email_unsubscribe_tokens WHERE user_id = ?").bind(row.id),
      env.DB.prepare("UPDATE email_logs SET to_email = ? WHERE user_id = ?")
        .bind(`deleted+${row.id}@invalid.local`, row.id),
      env.DB.prepare("DELETE FROM email_suppressions WHERE email = ?").bind(row.email.toLowerCase()),
      env.DB.prepare("UPDATE audit_logs SET actor_id = NULL, ip_hash = NULL WHERE actor_id = ? OR (target_type = 'user' AND target_id = ?)")
        .bind(row.id, row.id),
      env.DB.prepare(
        `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, meta_json, ip_hash, created_at)
         VALUES (?, NULL, 'user.anonymize', 'user', ?, NULL, NULL, ?)`,
      ).bind(ulid(), row.id, now),
    ]);
    anonymized++;
  }
  return { anonymized };
}

export const accountRoutes = new Hono<AppEnv>();

accountRoutes.post("/api/me/export", requireAuth, requireActive, async (c) => {
  const user = c.get("user")!;
  const payload = await exportPayload(c.env.DB, user);
  c.header("content-type", "application/json; charset=utf-8");
  c.header("content-disposition", `attachment; filename="forum-export-${user.id}.json"`);
  c.header("cache-control", "no-store");
  return c.body(JSON.stringify(payload, null, 2));
});

accountRoutes.post("/api/me/delete", requireAuth, async (c) => {
  const user = c.get("user")!;
  const parsed = deleteAccountSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(fail("validation_error", "请输入密码确认"), 400);
  const limit = await consumeRateLimit(c.env, `delete-account:${user.id}`, 3600, 5);
  if (!limit.allowed) return c.json(fail("rate_limited", "尝试次数过多，请稍后再试"), 429);
  const account = await c.env.DB.prepare(
    "SELECT password FROM account WHERE user_id = ? AND provider_id = 'credential'",
  ).bind(user.id).first<{ password: string | null }>();
  if (!account?.password || !timingSafeEqual(account.password, await hmacB64(c.env.PASSWORD_PEPPER, parsed.data.password))) {
    return c.json(fail("forbidden", "密码不正确"), 403);
  }
  if (user.role === "admin") {
    const otherAdmins = await c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM user WHERE role = 'admin' AND status = 'active' AND id != ?",
    ).bind(user.id).first<{ n: number }>();
    if (Number(otherAdmins?.n ?? 0) === 0) {
      return c.json(fail("forbidden", "不能注销最后一个管理员"), 403);
    }
  }
  const config = await getConfig(c.env);
  const now = Math.floor(Date.now() / 1000);
  const finalizeAt = now + config.config.account.deletionGraceDays * 86_400;
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE user SET status = 'deleting', deleted_at = ?, updated_at = ? WHERE id = ?").bind(now, now, user.id),
    c.env.DB.prepare("DELETE FROM session WHERE user_id = ?").bind(user.id),
    c.env.DB.prepare(
      `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, meta_json, ip_hash, created_at)
       VALUES (?, ?, 'user.delete.request', 'user', ?, ?, NULL, ?)`,
    ).bind(ulid(), user.id, user.id, JSON.stringify({ finalizeAt }), now),
  ]);
  return c.json(ok({ deleting: true, finalizeAt }));
});


accountRoutes.post("/api/me/delete/cancel", requireAuth, async (c) => {
  const user = c.get("user")!;
  if (user.status !== "deleting") {
    return c.json(ok({ deleting: false, cancelled: false }));
  }
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE user SET status = 'active', deleted_at = NULL, updated_at = ? WHERE id = ?").bind(now, user.id),
    c.env.DB.prepare(
      `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, meta_json, ip_hash, created_at)
       VALUES (?, ?, 'user.delete.cancel', 'user', ?, NULL, NULL, ?)`,
    ).bind(ulid(), user.id, user.id, now),
  ]);
  return c.json(ok({ deleting: false, cancelled: true }));
});

accountRoutes.post("/api/admin/maintenance/cleanup", requireAdmin, async (c) => {
  const result = await runAccountCleanup(c.env);
  await markMaintenanceRun(c.env, "cleanup");
  return c.json(ok(result));
});
