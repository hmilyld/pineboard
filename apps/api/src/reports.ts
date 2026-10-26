import { createReportSchema, fail, ok, resolveReportSchema, ulid } from "@pineboard/shared";
import { Hono } from "hono";
import { getSecurityConfig } from "./config";
import type { AppEnv } from "./env";
import { requireActive, requireAuth, requireModerator } from "./middleware/guards";
import { isCategoryModerator } from "./permissions";
import { consumeRateLimit } from "./security";

type Target = { categoryId: string; topicId: string; authorId: string; title: string; snippet: string; postId: string | null };

async function resolveTarget(db: D1Database, type: string, id: string): Promise<Target | null> {
  if (type === "topic") {
    const row = await db.prepare(
      `SELECT t.id AS topic_id, t.category_id, t.author_id, p.title, p.content_text
         FROM topics t JOIN posts p ON p.topic_id = t.id AND p.is_first = 1
        WHERE t.id = ? AND t.status = 'published'`,
    ).bind(id).first<{ topic_id: string; category_id: string; author_id: string; title: string; content_text: string }>();
    return row ? { categoryId: row.category_id, topicId: row.topic_id, authorId: row.author_id, title: row.title, snippet: row.content_text.slice(0, 160), postId: null } : null;
  }
  const row = await db.prepare(
    `SELECT p.id AS post_id, p.topic_id, t.category_id, p.author_id, p.content_text,
            (SELECT fp.title FROM posts fp WHERE fp.topic_id = t.id AND fp.is_first = 1 LIMIT 1) AS title
       FROM posts p JOIN topics t ON t.id = p.topic_id
      WHERE p.id = ? AND p.status = 'published' AND t.status = 'published'`,
  ).bind(id).first<{ post_id: string; topic_id: string; category_id: string; author_id: string; content_text: string; title: string }>();
  return row ? { categoryId: row.category_id, topicId: row.topic_id, authorId: row.author_id, title: row.title, snippet: row.content_text.slice(0, 160), postId: row.post_id } : null;
}

export const reportRoutes = new Hono<AppEnv>();

reportRoutes.post("/api/reports", requireAuth, requireActive, async (c) => {
  const user = c.get("user")!;
  const security = await getSecurityConfig(c.env);
  if (!security.config.feature.reports) return c.json(fail("not_found", "举报功能未开启"), 404);
  const parsed = createReportSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(fail("validation_error", "举报参数不合法", { body: parsed.error.issues.map((i) => i.message) }), 400);
  const target = await resolveTarget(c.env.DB, parsed.data.targetType, parsed.data.targetId);
  if (!target) return c.json(fail("not_found", "举报目标不存在"), 404);
  const duplicate = await c.env.DB.prepare(
    "SELECT 1 AS ok FROM reports WHERE reporter_id = ? AND target_type = ? AND target_id = ? AND status = 'pending'",
  ).bind(user.id, parsed.data.targetType, parsed.data.targetId).first();
  if (duplicate) return c.json(fail("conflict", "你已举报过该内容"), 409);
  const limit = await consumeRateLimit(c.env, `report:${user.id}`, 86_400, security.config.security.reportDailyLimit);
  if (!limit.allowed) return c.json(fail("rate_limited", "今日举报次数已用完"), 429);
  const now = Math.floor(Date.now() / 1000);
  try {
    await c.env.DB.prepare(
      `INSERT INTO reports (id, reporter_id, target_type, target_id, category_id, topic_id, post_id,
         target_title, target_snippet, reason_code, detail, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    ).bind(
      ulid(), user.id, parsed.data.targetType, parsed.data.targetId, target.categoryId,
      target.topicId, target.postId, target.title, target.snippet, parsed.data.reasonCode, parsed.data.detail, now,
    ).run();
  } catch (error) {
    if (error instanceof Error && /UNIQUE/.test(error.message)) return c.json(fail("conflict", "你已举报过该内容"), 409);
    throw error;
  }
  return c.json(ok({ reported: true }), 201);
});

reportRoutes.get("/api/mod/reports", requireModerator, async (c) => {
  const user = c.get("user")!;
  const status = c.req.query("status") ?? "pending";
  const pageRaw = Number(c.req.query("page") ?? 1);
  const perPageRaw = Number(c.req.query("perPage") ?? 20);
  const page = Number.isFinite(pageRaw) ? Math.max(1, Math.floor(pageRaw)) : 1;
  const perPage = Number.isFinite(perPageRaw) ? Math.min(50, Math.max(5, Math.floor(perPageRaw))) : 20;
  const where = `r.status = ? AND (? = 'admin' OR EXISTS (
    SELECT 1 FROM category_moderators cm WHERE cm.category_id = r.category_id AND cm.user_id = ?
  ))`;
  const [rows, countRow] = await Promise.all([
    c.env.DB.prepare(
      `SELECT r.*, u.name AS reporter_name, u.username AS reporter_username
         FROM reports r JOIN user u ON u.id = r.reporter_id
        WHERE ${where} ORDER BY r.created_at ASC LIMIT ? OFFSET ?`,
    ).bind(status, user.role, user.id, perPage, (page - 1) * perPage).all<Record<string, unknown>>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS total FROM reports r WHERE ${where}`,
    ).bind(status, user.role, user.id).first<{ total: number }>(),
  ]);
  const items = rows.results.map((row) => {
    const targetType = String(row.target_type);
    const targetId = String(row.target_id);
    return {
      id: String(row.id),
      reporter: { id: String(row.reporter_id), name: String(row.reporter_name), username: (row.reporter_username as string | null) ?? null },
      targetType,
      targetId,
      topicId: (row.topic_id as string | null) ?? (targetType === "topic" ? targetId : null),
      postId: (row.post_id as string | null) ?? (targetType === "post" ? targetId : null),
      targetTitle: (row.target_title as string | null) ?? "内容已删除",
      targetSnippet: (row.target_snippet as string | null) ?? "",
      reasonCode: String(row.reason_code),
      detail: String(row.detail ?? ""),
      status: String(row.status),
      createdAt: Number(row.created_at),
    };
  });
  const total = Number(countRow?.total ?? 0);
  return c.json(ok({ items, page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) }));
});

reportRoutes.post("/api/mod/reports/:id/resolve", requireModerator, async (c) => {
  const user = c.get("user")!;
  const report = await c.env.DB.prepare("SELECT * FROM reports WHERE id = ?").bind(c.req.param("id")).first<Record<string, unknown>>();
  if (!report) return c.json(fail("not_found", "举报不存在"), 404);
  const target = await resolveTarget(c.env.DB, String(report.target_type), String(report.target_id));
  const targetType = String(report.target_type);
  const targetId = String(report.target_id);
  const topicId = target?.topicId ?? (report.topic_id as string | null) ?? (targetType === "topic" ? targetId : null);
  const postId = target?.postId ?? (report.post_id as string | null) ?? (targetType === "post" ? targetId : null);
  const categoryId = target?.categoryId ?? (report.category_id as string | null);
  if (user.role !== "admin" && (!categoryId || !(await isCategoryModerator(c.env.DB, user, categoryId)))) {
    return c.json(fail("forbidden", "无权处理该举报"), 403);
  }
  const parsed = resolveReportSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(fail("validation_error", "处理参数不合法"), 400);
  const now = Math.floor(Date.now() / 1000);
  const statements = [
    c.env.DB.prepare("UPDATE reports SET status = ?, handled_by = ?, handled_at = ?, resolution_note = ? WHERE id = ?")
      .bind(parsed.data.status, user.id, now, parsed.data.resolutionNote || null, String(report.id)),
    c.env.DB.prepare(
      `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, meta_json, ip_hash, created_at)
       VALUES (?, ?, 'report.resolve', 'report', ?, ?, NULL, ?)`,
    ).bind(
      ulid(), user.id, String(report.id),
      JSON.stringify({ status: parsed.data.status, contentRemoved: !target }), now,
    ),
  ];
  if (topicId) {
    statements.splice(1, 0, c.env.DB.prepare(
      `INSERT INTO notifications (id, user_id, type, actor_id, topic_id, post_id, title, snippet, email_status, created_at)
       VALUES (?, ?, 'moderation', ?, ?, ?, '举报已处理', ?, 'pending', ?)`,
    ).bind(ulid(), String(report.reporter_id), user.id, topicId, postId, parsed.data.resolutionNote || parsed.data.status, now));
  }
  await c.env.DB.batch(statements);
  return c.json(ok({ status: parsed.data.status }));
});
