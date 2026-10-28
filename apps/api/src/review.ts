import { fail, ok, reviewDecisionSchema, ulid } from "@pineboard/shared";
import { Hono, type Context } from "hono";
import type { AppEnv } from "./env";
import { requireModerator } from "./middleware/guards";
import { isCategoryModerator } from "./permissions";

/**
 * Review queue for content withheld by the sensitive-word screen. Items are
 * normal published/hidden rows whose status is `pending`, so approving or
 * rejecting is a status transition rather than a separate store, and nothing
 * has to be migrated when the feature is turned off.
 */

function now(): number {
  return Math.floor(Date.now() / 1000);
}

type PendingRow = {
  kind: string;
  id: string;
  topic_id: string;
  category_id: string;
  author_id: string;
  author_name: string;
  title: string | null;
  content_md: string;
  created_at: number;
  keywords: string | null;
};

export const reviewRoutes = new Hono<AppEnv>();

/** Combined queue for topics and replies awaiting review. */
reviewRoutes.get("/api/mod/pending", requireModerator, async (c) => {
  const user = c.get("user")!;
  const rows = await c.env.DB.prepare(
    `SELECT 'topic' AS kind, t.id, t.id AS topic_id, t.category_id, t.author_id,
            u.name AS author_name, fp.title, fp.content_md, t.created_at,
            (SELECT a.meta_json FROM audit_logs a
              WHERE a.action = 'topic.create' AND a.target_id = t.id
              ORDER BY a.created_at DESC LIMIT 1) AS keywords
       FROM topics t
       JOIN user u ON u.id = t.author_id
       LEFT JOIN posts fp ON fp.id = t.first_post_id
      WHERE t.status = 'pending'
      UNION ALL
     SELECT 'post' AS kind, p.id, p.topic_id, t.category_id, p.author_id,
            u.name AS author_name, p.title, p.content_md, p.created_at,
            (SELECT a.meta_json FROM audit_logs a
              WHERE a.action = 'post.edit' AND a.target_id = p.id
              ORDER BY a.created_at DESC LIMIT 1) AS keywords
       FROM posts p
       JOIN topics t ON t.id = p.topic_id
       JOIN user u ON u.id = p.author_id
      WHERE p.status = 'pending' AND p.is_first = 0
      ORDER BY 9 ASC
      LIMIT 200`,
  ).all<PendingRow>();

  const visible = [];
  for (const row of rows.results) {
    if (user.role !== "admin" && !(await isCategoryModerator(c.env.DB, user, row.category_id))) continue;
    let keywords: string[] = [];
    if (row.keywords) {
      try {
        const meta = JSON.parse(row.keywords) as { keywords?: unknown };
        if (Array.isArray(meta.keywords)) keywords = meta.keywords.map(String);
      } catch {
        // A malformed audit entry is not worth failing the queue over.
      }
    }
    visible.push({
      kind: row.kind as "topic" | "post",
      id: row.id,
      topicId: row.topic_id,
      categoryId: row.category_id,
      authorId: row.author_id,
      authorName: row.author_name,
      title: row.title,
      contentMd: row.content_md,
      createdAt: row.created_at,
      keywords,
    });
  }
  return c.json(ok({ items: visible }));
});

async function decide(c: Context<AppEnv>, kind: "topic" | "post") {
  const user = c.get("user")!;
  const id = c.req.param("id")!;
  const parsed = reviewDecisionSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(fail("validation_error", "请选择通过或驳回"), 400);

  let categoryId: string;
  let targetAuthorId: string;
  let targetStatus: string;
  let targetTopicId = id;

  if (kind === "topic") {
    const topic = await c.env.DB.prepare(
      "SELECT id, category_id, status, author_id FROM topics WHERE id = ?",
    ).bind(id).first<{ id: string; category_id: string; status: string; author_id: string }>();
    if (!topic) return c.json(fail("not_found", "内容不存在"), 404);
    categoryId = topic.category_id;
    targetAuthorId = topic.author_id;
    targetStatus = topic.status;
  } else {
    const post = await c.env.DB.prepare(
      `SELECT p.id, p.topic_id, p.status, p.author_id, t.category_id AS category_id
         FROM posts p JOIN topics t ON t.id = p.topic_id WHERE p.id = ?`,
    ).bind(id).first<{ id: string; topic_id: string; status: string; author_id: string; category_id: string }>();
    if (!post) return c.json(fail("not_found", "内容不存在"), 404);
    categoryId = post.category_id;
    targetAuthorId = post.author_id;
    targetStatus = post.status;
    targetTopicId = post.topic_id;
  }

  if (user.role !== "admin" && !(await isCategoryModerator(c.env.DB, user, categoryId))) {
    return c.json(fail("forbidden", "无权管理该版块"), 403);
  }
  if (targetStatus !== "pending") return c.json(fail("conflict", "内容不在待审核状态"), 409);

  const ts = now();
  const approve = parsed.data.action === "approve";
  const statements: D1PreparedStatement[] = [];

  if (kind === "topic") {
    statements.push(
      c.env.DB.prepare("UPDATE topics SET status = ?, updated_at = ? WHERE id = ? AND status = 'pending'").bind(
        approve ? "published" : "rejected",
        ts,
        id,
      ),
      c.env.DB.prepare("UPDATE posts SET status = ?, updated_at = ? WHERE topic_id = ? AND status = 'pending'").bind(
        approve ? "published" : "rejected",
        ts,
        id,
      ),
    );
  } else {
    statements.push(
      c.env.DB.prepare(
        `UPDATE posts SET status = ?, updated_at = ?, deleted_at = ?, deleted_by = ?
          WHERE id = ? AND status = 'pending'`,
      ).bind(approve ? "published" : "rejected", ts, approve ? null : ts, approve ? null : user.id, id),
      // A pending reply never bumped the counters; approving it must.
      c.env.DB.prepare(
        `UPDATE topics SET reply_count = reply_count + 1, last_post_at = ?, last_post_user_id = ?, updated_at = ?
          WHERE id = ? AND ? = 1 AND status = 'published'`,
      ).bind(ts, targetAuthorId, ts, targetTopicId, approve ? 1 : 0),
    );
  }

  statements.push(
    c.env.DB.prepare(
      `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, meta_json, ip_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
    ).bind(
      ulid(),
      user.id,
      approve ? "review.approve" : "review.reject",
      kind,
      id,
      JSON.stringify({ reason: parsed.data.reason ?? null }),
      ts,
    ),
  );

  const results = await c.env.DB.batch(statements);
  if (Number(results[0]?.meta.changes ?? 0) === 0) return c.json(fail("conflict", "内容已被处理，请刷新"), 409);
  return c.json(ok({ id, status: approve ? "published" : "rejected" }));
}

reviewRoutes.post("/api/mod/topics/:id/review", requireModerator, (c) => decide(c, "topic"));
reviewRoutes.post("/api/mod/posts/:id/review", requireModerator, (c) => decide(c, "post"));
