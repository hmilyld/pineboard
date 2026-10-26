import { digestTopicSchema, fail, lockTopicSchema, moveTopicSchema, ok, pinTopicSchema, ulid } from "@pineboard/shared";
import { Hono } from "hono";
import type { AppEnv } from "./env";
import { requireAdmin, requireModerator } from "./middleware/guards";
import { isCategoryModerator } from "./permissions";
import { ftsDeleteStatement, ftsInsertStatement } from "./search-index";

type TopicRow = { id: string; category_id: string; status: string; pin_order: number };

async function topicFor(db: D1Database, id: string): Promise<TopicRow | null> {
  return await db
    .prepare("SELECT id, category_id, status, pin_order FROM topics WHERE id = ? AND status = 'published'")
    .bind(id)
    .first<TopicRow>();
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

export const moderationRoutes = new Hono<AppEnv>();

moderationRoutes.post("/api/mod/topics/:id/pin", requireModerator, async (c) => {
  const user = c.get("user")!;
  const topic = await topicFor(c.env.DB, c.req.param("id"));
  if (!topic) return c.json(fail("not_found", "主题不存在"), 404);
  if (user.role !== "admin" && !(await isCategoryModerator(c.env.DB, user, topic.category_id))) {
    return c.json(fail("forbidden", "无权管理该版块"), 403);
  }
  const parsed = pinTopicSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(fail("validation_error", "置顶参数不合法"), 400);
  if (parsed.data.pinLevel === 2 && user.role !== "admin") {
    return c.json(fail("forbidden", "只有管理员可以全局置顶"), 403);
  }
  const order = parsed.data.pinOrder ?? topic.pin_order;
  const ts = now();
  const results = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE topics SET pin_level = ?, pin_order = ?, updated_at = ? WHERE id = ? AND status = 'published'")
      .bind(parsed.data.pinLevel, order, ts, topic.id),
    c.env.DB.prepare(
      `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, meta_json, ip_hash, created_at)
       SELECT ?, ?, 'topic.pin', 'topic', ?, ?, NULL, ?
        WHERE EXISTS (SELECT 1 FROM topics WHERE id = ? AND status = 'published')`,
    ).bind(ulid(), user.id, topic.id, JSON.stringify(parsed.data), ts, topic.id),
  ]);
  if (Number(results[0]?.meta.changes ?? 0) === 0) return c.json(fail("conflict", "主题状态已变化，请刷新"), 409);
  return c.json(ok({ pinLevel: parsed.data.pinLevel, pinOrder: order }));
});


moderationRoutes.post("/api/mod/topics/:id/digest", requireModerator, async (c) => {
  const user = c.get("user")!;
  const topic = await topicFor(c.env.DB, c.req.param("id"));
  if (!topic) return c.json(fail("not_found", "主题不存在"), 404);
  if (user.role !== "admin" && !(await isCategoryModerator(c.env.DB, user, topic.category_id))) {
    return c.json(fail("forbidden", "无权管理该版块"), 403);
  }
  const parsed = digestTopicSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(fail("validation_error", "精华参数不合法"), 400);
  const ts = now();
  const results = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE topics SET is_digest = ?, updated_at = ? WHERE id = ? AND status = 'published'")
      .bind(parsed.data.isDigest ? 1 : 0, ts, topic.id),
    c.env.DB.prepare(
      `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, meta_json, ip_hash, created_at)
       SELECT ?, ?, 'topic.digest', 'topic', ?, ?, NULL, ?
        WHERE EXISTS (SELECT 1 FROM topics WHERE id = ? AND status = 'published')`,
    ).bind(ulid(), user.id, topic.id, JSON.stringify(parsed.data), ts, topic.id),
  ]);
  if (Number(results[0]?.meta.changes ?? 0) === 0) return c.json(fail("conflict", "主题状态已变化，请刷新"), 409);
  return c.json(ok({ isDigest: parsed.data.isDigest }));
});

moderationRoutes.post("/api/mod/topics/:id/lock", requireModerator, async (c) => {
  const user = c.get("user")!;
  const topic = await topicFor(c.env.DB, c.req.param("id"));
  if (!topic) return c.json(fail("not_found", "主题不存在"), 404);
  if (user.role !== "admin" && !(await isCategoryModerator(c.env.DB, user, topic.category_id))) {
    return c.json(fail("forbidden", "无权管理该版块"), 403);
  }
  const parsed = lockTopicSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(fail("validation_error", "锁定参数不合法"), 400);
  const ts = now();
  const results = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE topics SET is_locked = ?, updated_at = ? WHERE id = ? AND status = 'published'")
      .bind(parsed.data.locked ? 1 : 0, ts, topic.id),
    c.env.DB.prepare(
      `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, meta_json, ip_hash, created_at)
       SELECT ?, ?, 'topic.lock', 'topic', ?, ?, NULL, ?
        WHERE EXISTS (SELECT 1 FROM topics WHERE id = ? AND status = 'published')`,
    ).bind(ulid(), user.id, topic.id, JSON.stringify(parsed.data), ts, topic.id),
  ]);
  if (Number(results[0]?.meta.changes ?? 0) === 0) return c.json(fail("conflict", "主题状态已变化，请刷新"), 409);
  return c.json(ok({ locked: parsed.data.locked }));
});

moderationRoutes.post("/api/mod/topics/:id/move", requireModerator, async (c) => {
  const user = c.get("user")!;
  const topic = await topicFor(c.env.DB, c.req.param("id"));
  if (!topic) return c.json(fail("not_found", "主题不存在"), 404);
  const parsed = moveTopicSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(fail("validation_error", "移动参数不合法"), 400);
  const target = await c.env.DB.prepare("SELECT id, slug, name FROM categories WHERE id = ? AND is_visible = 1")
    .bind(parsed.data.categoryId).first<{ id: string; slug: string; name: string }>();
  if (!target) return c.json(fail("not_found", "目标版块不存在"), 404);
  if (user.role !== "admin") {
    const sourceOk = await isCategoryModerator(c.env.DB, user, topic.category_id);
    const targetOk = await isCategoryModerator(c.env.DB, user, target.id);
    if (!sourceOk || !targetOk) return c.json(fail("forbidden", "需要同时管理源版块和目标版块"), 403);
  }
  const ts = now();
  const updated = await c.env.DB.prepare(
    "UPDATE topics SET category_id = ?, updated_at = ? WHERE id = ? AND status = 'published'",
  ).bind(target.id, ts, topic.id).run();
  if (Number(updated.meta.changes ?? 0) === 0) return c.json(fail("conflict", "主题状态已变化，请刷新"), 409);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE reports SET category_id = ? WHERE status = 'pending' AND target_type = 'topic' AND target_id = ?").bind(target.id, topic.id),
    c.env.DB.prepare(
      `UPDATE reports SET category_id = ? WHERE status = 'pending' AND target_type = 'post'
        AND target_id IN (SELECT id FROM posts WHERE topic_id = ?)`,
    ).bind(target.id, topic.id),
    c.env.DB.prepare(
      `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, meta_json, ip_hash, created_at)
       VALUES (?, ?, 'topic.move', 'topic', ?, ?, NULL, ?)`,
    ).bind(ulid(), user.id, topic.id, JSON.stringify({ from: topic.category_id, to: target.id }), ts),
  ]);
  return c.json(ok({ category: { id: target.id, slug: target.slug, name: target.name } }));
});

moderationRoutes.get("/api/mod/audit", requireAdmin, async (c) => {
  const rawLimit = Number(c.req.query("limit") ?? 50);
  const limit = Number.isFinite(rawLimit) ? Math.min(200, Math.max(1, Math.floor(rawLimit))) : 50;
  const rows = await c.env.DB.prepare(
    `SELECT a.id, a.actor_id, a.action, a.target_type, a.target_id, a.meta_json, a.created_at,
            u.name AS actor_name, u.username AS actor_username
       FROM audit_logs a LEFT JOIN user u ON u.id = a.actor_id
      ORDER BY a.created_at DESC LIMIT ?`,
  ).bind(limit).all<Record<string, unknown>>();
  return c.json(ok(rows.results.map((row) => ({
    id: String(row.id),
    actorId: (row.actor_id as string | null) ?? null,
    actorName: (row.actor_name as string | null) ?? null,
    actorUsername: (row.actor_username as string | null) ?? null,
    action: String(row.action),
    targetType: (row.target_type as string | null) ?? null,
    targetId: (row.target_id as string | null) ?? null,
    meta: row.meta_json ? JSON.parse(String(row.meta_json)) : null,
    createdAt: Number(row.created_at),
  }))));
});

// Admin-only restore for a soft-deleted post (and the topic's posts deleted with it).
moderationRoutes.post("/api/mod/posts/:id/restore", requireAdmin, async (c) => {
  const user = c.get("user")!;
  const post = await c.env.DB.prepare(
    `SELECT p.id, p.topic_id, p.is_first, p.version, p.title, p.content_md, p.status,
            (SELECT fp.title FROM posts fp WHERE fp.topic_id = p.topic_id AND fp.is_first = 1 LIMIT 1) AS topic_title,
            (SELECT t.deleted_at FROM topics t WHERE t.id = p.topic_id) AS topic_deleted_at,
            (SELECT t.status FROM topics t WHERE t.id = p.topic_id) AS topic_status
       FROM posts p WHERE p.id = ?`,
  ).bind(c.req.param("id")).first<{
    id: string; topic_id: string; is_first: number; version: number; title: string | null;
    content_md: string; status: string; topic_title: string | null; topic_deleted_at: number | null;
    topic_status: string;
  }>();
  if (!post) return c.json(fail("not_found", "内容不存在"), 404);
  if (post.status !== "deleted") return c.json(fail("conflict", "内容未被删除"), 409);
  if (!Number(post.is_first) && post.topic_status !== "published") {
    return c.json(fail("conflict", "所属主题已删除，请先恢复主题"), 409);
  }
  const ts = now();
  const posts = await c.env.DB.prepare(
    `SELECT id, title, content_md, is_first, status, deleted_at FROM posts WHERE topic_id = ? ORDER BY floor`,
  ).bind(post.topic_id).all<{ id: string; title: string | null; content_md: string; is_first: number; status: string; deleted_at: number | null }>();

  const restoreIds = new Set<string>([post.id]);
  if (Number(post.is_first) && post.topic_deleted_at != null) {
    for (const row of posts.results) {
      if (row.status === "deleted" && row.deleted_at === post.topic_deleted_at) restoreIds.add(row.id);
    }
  }
  const restoredRows = posts.results.filter((row) => restoreIds.has(row.id));

  const statements: D1PreparedStatement[] = [];
  if (Number(post.is_first) && post.topic_deleted_at != null) {
    statements.push(
      c.env.DB.prepare(
        `UPDATE posts SET status = 'published', deleted_at = NULL, deleted_by = NULL, updated_at = ?
          WHERE topic_id = ? AND status = 'deleted' AND deleted_at = ?`,
      ).bind(ts, post.topic_id, post.topic_deleted_at),
    );
  } else {
    statements.push(
      c.env.DB.prepare(
        `UPDATE posts SET status = 'published', deleted_at = NULL, deleted_by = NULL, updated_at = ? WHERE id = ?`,
      ).bind(ts, post.id),
    );
  }
  statements.push(
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO post_revisions (id, topic_id, post_id, version, title, content_md, action, editor_id, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'restore', ?, NULL, ?)`,
    ).bind(ulid(), post.topic_id, post.id, post.version, post.title, post.content_md, user.id, ts),
  );
  if (Number(post.is_first)) {
    statements.push(
      c.env.DB.prepare(
        `UPDATE topics SET status = 'published', deleted_at = NULL, deleted_by = NULL, updated_at = ?,
           reply_count = (SELECT COUNT(*) FROM posts WHERE topic_id = ? AND is_first = 0 AND status = 'published'),
           last_post_at = COALESCE((SELECT MAX(created_at) FROM posts WHERE topic_id = ? AND status = 'published'), created_at),
           last_post_user_id = (SELECT author_id FROM posts WHERE topic_id = ? AND status = 'published' ORDER BY floor DESC LIMIT 1)
         WHERE id = ?`,
      ).bind(ts, post.topic_id, post.topic_id, post.topic_id, post.topic_id),
    );
  } else {
    statements.push(
      c.env.DB.prepare(
        `UPDATE topics SET updated_at = ?,
           reply_count = (SELECT COUNT(*) FROM posts WHERE topic_id = ? AND is_first = 0 AND status = 'published'),
           last_post_at = COALESCE((SELECT MAX(created_at) FROM posts WHERE topic_id = ? AND status = 'published'), created_at),
           last_post_user_id = (SELECT author_id FROM posts WHERE topic_id = ? AND status = 'published' ORDER BY floor DESC LIMIT 1)
         WHERE id = ?`,
      ).bind(ts, post.topic_id, post.topic_id, post.topic_id, post.topic_id),
    );
  }
  statements.push(
    c.env.DB.prepare(
      `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, meta_json, ip_hash, created_at)
       VALUES (?, ?, 'post.restore', 'post', ?, ?, NULL, ?)`,
    ).bind(ulid(), user.id, post.id, JSON.stringify({ topicRestored: Number(post.is_first) === 1 }), ts),
  );
  await c.env.DB.batch(statements);

  // Rebuild FTS only for the rows actually restored, in bounded chunks.
  for (let index = 0; index < restoredRows.length; index += 25) {
    const chunk = restoredRows.slice(index, index + 25);
    await c.env.DB.batch(
      chunk.flatMap((row) => [
        ftsDeleteStatement(c.env.DB, row.id),
        ftsInsertStatement(c.env.DB, {
          postId: row.id,
          topicId: post.topic_id,
          title: Number(row.is_first) === 1 ? String(row.title ?? post.topic_title ?? "") : "",
          content: String(row.content_md ?? ""),
        }),
      ]),
    );
  }
  return c.json(ok({ restored: true }));
});
