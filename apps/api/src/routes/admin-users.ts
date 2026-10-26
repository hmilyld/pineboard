import { adminUserSuspendSchema, adminUserUpdateSchema, fail, ok, ulid, type AdminUser } from "@pineboard/shared";
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { requireAdmin } from "../middleware/guards";

type UserRow = {
  id: string; name: string; email: string; username: string | null; role: string; status: string;
  email_verified: number; created_at: number; topic_count: number; reply_count: number;
};

function mapUser(row: UserRow): AdminUser {
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    username: (row.username as string | null) ?? null,
    role: row.role === "admin" ? "admin" : row.role === "moderator" ? "moderator" : "user",
    status: row.status === "suspended" || row.status === "deleting" || row.status === "deleted" ? row.status : "active",
    emailVerified: Number(row.email_verified) === 1,
    createdAt: Number(row.created_at),
    topicCount: Number(row.topic_count ?? 0),
    replyCount: Number(row.reply_count ?? 0),
  };
}

async function activeAdminCount(db: D1Database, excludeId?: string): Promise<number> {
  const row = excludeId
    ? await db.prepare("SELECT COUNT(*) AS n FROM user WHERE role = 'admin' AND status = 'active' AND id != ?").bind(excludeId).first<{ n: number }>()
    : await db.prepare("SELECT COUNT(*) AS n FROM user WHERE role = 'admin' AND status = 'active'").first<{ n: number }>();
  return Number(row?.n ?? 0);
}

export const adminUserRoutes = new Hono<AppEnv>();

adminUserRoutes.get("/api/admin/users", requireAdmin, async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 100);
  const status = c.req.query("status") ?? "all";
  const role = c.req.query("role") ?? "all";
  const pageRaw = Number(c.req.query("page") ?? 1);
  const page = Number.isFinite(pageRaw) ? Math.min(10_000, Math.max(1, Math.floor(pageRaw))) : 1;
  const perPage = 20;
  if (!["all", "active", "suspended", "deleting", "deleted"].includes(status)) {
    return c.json(fail("validation_error", "状态筛选不合法"), 400);
  }
  if (!["all", "user", "moderator", "admin"].includes(role)) {
    return c.json(fail("validation_error", "角色筛选不合法"), 400);
  }
  const where: string[] = ["1 = 1"];
  const binds: unknown[] = [];
  if (q) {
    const needle = q.toLowerCase();
    where.push("(instr(lower(email), ?) > 0 OR instr(lower(name), ?) > 0 OR instr(lower(COALESCE(username, '')), ?) > 0)");
    binds.push(needle, needle, needle);
  }
  if (status !== "all") { where.push("status = ?"); binds.push(status); }
  if (role !== "all") { where.push("role = ?"); binds.push(role); }
  const [rows, count] = await Promise.all([
    c.env.DB.prepare(
      `SELECT u.id, u.name, u.email, u.username, u.role, u.status, u.email_verified, u.created_at,
              (SELECT COUNT(*) FROM topics t WHERE t.author_id = u.id AND t.status = 'published') AS topic_count,
              (SELECT COUNT(*) FROM posts p WHERE p.author_id = u.id AND p.status = 'published' AND p.is_first = 0) AS reply_count
         FROM user u WHERE ${where.join(" AND ")} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
    ).bind(...binds, perPage, (page - 1) * perPage).all<UserRow>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS total FROM user WHERE ${where.join(" AND ")}`).bind(...binds).first<{ total: number }>(),
  ]);
  const total = Number(count?.total ?? 0);
  c.header("cache-control", "no-store");
  return c.json(ok({ items: rows.results.map(mapUser), page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) }));
});

adminUserRoutes.patch("/api/admin/users/:id", requireAdmin, async (c) => {
  const actor = c.get("user")!;
  const id = c.req.param("id");
  if (id === actor.id) return c.json(fail("forbidden", "不能修改自己的角色"), 403);
  const parsed = adminUserUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(fail("validation_error", "角色参数不合法"), 400);
  const target = await c.env.DB.prepare("SELECT id, role, status FROM user WHERE id = ?").bind(id).first<{ id: string; role: string; status: string }>();
  if (!target) return c.json(fail("not_found", "用户不存在"), 404);
  if (target.role === "admin" && parsed.data.role !== "admin" && await activeAdminCount(c.env.DB, id) < 1) {
    return c.json(fail("conflict", "不能降级最后一个管理员"), 409);
  }
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE user SET role = ?, updated_at = ? WHERE id = ?").bind(parsed.data.role, now, id),
    c.env.DB.prepare(
      `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, meta_json, ip_hash, created_at)
       VALUES (?, ?, 'user.role', 'user', ?, ?, NULL, ?)`,
    ).bind(ulid(), actor.id, id, JSON.stringify({ from: target.role, to: parsed.data.role }), now),
  ]);
  return c.json(ok({ role: parsed.data.role }));
});

adminUserRoutes.post("/api/admin/users/:id/suspend", requireAdmin, async (c) => {
  const actor = c.get("user")!;
  const id = c.req.param("id");
  if (id === actor.id) return c.json(fail("forbidden", "不能封禁自己"), 403);
  const parsed = adminUserSuspendSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json(fail("validation_error", "封禁原因不合法"), 400);
  const target = await c.env.DB.prepare("SELECT id, role, status FROM user WHERE id = ?").bind(id).first<{ id: string; role: string; status: string }>();
  if (!target) return c.json(fail("not_found", "用户不存在"), 404);
  if (target.status === "deleted") return c.json(fail("conflict", "已注销用户不能封禁"), 409);
  if (target.role === "admin" && await activeAdminCount(c.env.DB, id) < 1) {
    return c.json(fail("conflict", "不能封禁最后一个管理员"), 409);
  }
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE user SET status = 'suspended', updated_at = ? WHERE id = ?").bind(now, id),
    c.env.DB.prepare("DELETE FROM session WHERE user_id = ?").bind(id),
    c.env.DB.prepare(
      `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, meta_json, ip_hash, created_at)
       VALUES (?, ?, 'user.suspend', 'user', ?, ?, NULL, ?)`,
    ).bind(ulid(), actor.id, id, JSON.stringify({ reason: parsed.data.reason }), now),
  ]);
  return c.json(ok({ status: "suspended" }));
});

adminUserRoutes.post("/api/admin/users/:id/unsuspend", requireAdmin, async (c) => {
  const actor = c.get("user")!;
  const id = c.req.param("id");
  const target = await c.env.DB.prepare("SELECT id, status FROM user WHERE id = ?").bind(id).first<{ id: string; status: string }>();
  if (!target) return c.json(fail("not_found", "用户不存在"), 404);
  if (target.status !== "suspended") return c.json(fail("conflict", "用户当前不是封禁状态"), 409);
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE user SET status = 'active', updated_at = ? WHERE id = ?").bind(now, id),
    c.env.DB.prepare(
      `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, meta_json, ip_hash, created_at)
       VALUES (?, ?, 'user.unsuspend', 'user', ?, NULL, NULL, ?)`,
    ).bind(ulid(), actor.id, id, now),
  ]);
  return c.json(ok({ status: "active" }));
});
