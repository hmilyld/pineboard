import { ok, type TopicSummary } from "@pineboard/shared";
import { Hono } from "hono";
import type { AppEnv } from "./env";
import { loadTags, mapPost, mapTopic, topicSelect } from "./forum";
import { requireAuth } from "./middleware/guards";

type JoinRow = Record<string, unknown>;

async function userByUsername(db: D1Database, username: string): Promise<{ id: string; username: string; name: string; bio: string | null; avatar_key: string | null; role: string; created_at: number } | null> {
  return await db
    .prepare("SELECT id, username, name, bio, avatar_key, role, created_at FROM user WHERE username = ? AND status = 'active'")
    .bind(username.toLowerCase())
    .first();
}

async function topicsByAuthor(db: D1Database, authorId: string, page: number, perPage: number) {
  const totalRow = await db
    .prepare("SELECT COUNT(*) AS total FROM topics t JOIN categories c ON c.id = t.category_id WHERE t.author_id = ? AND t.status = 'published' AND c.is_visible = 1")
    .bind(authorId)
    .first<{ total: number }>();
  const rows = await db
    .prepare(`${topicSelect} WHERE t.author_id = ? AND t.status = 'published' AND c.is_visible = 1 ORDER BY t.created_at DESC LIMIT ? OFFSET ?`)
    .bind(authorId, perPage, (page - 1) * perPage)
    .all<JoinRow>();
  const tags = await loadTags(db, rows.results.map((row) => String(row.id)));
  const total = Number(totalRow?.total ?? 0);
  return {
    items: rows.results.map((row) => mapTopic(row, tags.get(String(row.id)) ?? [])),
    page,
    perPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
  };
}

async function repliesByAuthor(db: D1Database, authorId: string, viewerId: string, page: number, perPage: number) {
  const totalRow = await db
    .prepare(
      `SELECT COUNT(*) AS total FROM posts p JOIN topics t ON t.id = p.topic_id
        WHERE p.author_id = ? AND p.is_first = 0 AND p.status = 'published' AND t.status = 'published'`,
    )
    .bind(authorId)
    .first<{ total: number }>();
  const rows = await db
    .prepare(
      `SELECT p.*, (SELECT fp.title FROM posts fp WHERE fp.topic_id = t.id AND fp.is_first = 1 LIMIT 1) AS topic_title, c.slug AS category_slug, c.name AS category_name, c.color AS category_color,
              u.id AS author_id, u.username AS author_username, u.name AS author_name, u.avatar_key AS author_avatar_key,
              EXISTS (SELECT 1 FROM post_likes pl WHERE pl.post_id = p.id AND pl.user_id = ?) AS liked_by_me
         FROM posts p JOIN topics t ON t.id = p.topic_id JOIN categories c ON c.id = t.category_id
         JOIN user u ON u.id = p.author_id
        WHERE p.author_id = ? AND p.is_first = 0 AND p.status = 'published' AND t.status = 'published'
        ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
    )
    .bind(viewerId, authorId, perPage, (page - 1) * perPage)
    .all<JoinRow>();
  const total = Number(totalRow?.total ?? 0);
  return {
    items: rows.results.map((row) => ({
      ...mapPost(row),
      topic: { id: String(row.topic_id), title: String(row.topic_title), category: { slug: String(row.category_slug), name: String(row.category_name), color: String(row.category_color ?? "#14513f") } },
    })),
    page,
    perPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
  };
}

function pageParams(c: { req: { query(name: string): string | undefined } }): { page: number; perPage: number } {
  const pageRaw = Number(c.req.query("page") ?? 1);
  const perPageRaw = Number(c.req.query("perPage") ?? 20);
  const page = Number.isFinite(pageRaw) ? Math.max(1, Math.floor(pageRaw)) : 1;
  const perPage = Number.isFinite(perPageRaw) ? Math.min(50, Math.max(5, Math.floor(perPageRaw))) : 20;
  return { page, perPage };
}

export const userRoutes = new Hono<AppEnv>();

userRoutes.get("/api/users/:username", async (c) => {
  const user = await userByUsername(c.env.DB, c.req.param("username"));
  if (!user) return c.json({ ok: false, error: { code: "not_found", message: "用户不存在" } }, 404);
  const counts = await c.env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM topics WHERE author_id = ? AND status = 'published') AS topics,
       (SELECT COUNT(*) FROM posts WHERE author_id = ? AND is_first = 0 AND status = 'published') AS replies,
       (SELECT COUNT(*) FROM post_likes pl JOIN posts p ON p.id = pl.post_id
         WHERE p.author_id = ? AND p.status = 'published') AS likes,
       (SELECT COUNT(*) FROM bookmarks b JOIN topics t ON t.id = b.topic_id
         WHERE t.author_id = ? AND t.status = 'published') AS bookmarks`,
  ).bind(user.id, user.id, user.id, user.id).first<{ topics: number; replies: number; likes: number; bookmarks: number }>();
  return c.json({ ok: true, data: {
    id: user.id, username: user.username, name: user.name, bio: user.bio,
    avatarKey: user.avatar_key, role: user.role, createdAt: Number(user.created_at),
    topicCount: Number(counts?.topics ?? 0), replyCount: Number(counts?.replies ?? 0),
    likeCount: Number(counts?.likes ?? 0), bookmarkCount: Number(counts?.bookmarks ?? 0),
  } });
});

userRoutes.get("/api/users/:username/topics", async (c) => {
  const user = await userByUsername(c.env.DB, c.req.param("username"));
  if (!user) return c.json({ ok: false, error: { code: "not_found", message: "用户不存在" } }, 404);
  const { page, perPage } = pageParams(c);
  return c.json(ok(await topicsByAuthor(c.env.DB, user.id, page, perPage)));
});

userRoutes.get("/api/users/:username/replies", async (c) => {
  const user = await userByUsername(c.env.DB, c.req.param("username"));
  if (!user) return c.json({ ok: false, error: { code: "not_found", message: "用户不存在" } }, 404);
  const { page, perPage } = pageParams(c);
  return c.json(ok(await repliesByAuthor(c.env.DB, user.id, c.get("user")?.id ?? "", page, perPage)));
});

userRoutes.get("/api/me/bookmarks", requireAuth, async (c) => {
  const user = c.get("user")!;
  const { page, perPage } = pageParams(c);
  const totalRow = await c.env.DB.prepare("SELECT COUNT(*) AS total FROM bookmarks b JOIN topics t ON t.id = b.topic_id WHERE b.user_id = ? AND t.status = 'published'")
    .bind(user.id).first<{ total: number }>();
  const rows = await c.env.DB.prepare(
    `${topicSelect} JOIN bookmarks b ON b.topic_id = t.id
      WHERE b.user_id = ? AND t.status = 'published' AND c.is_visible = 1
      ORDER BY b.created_at DESC LIMIT ? OFFSET ?`,
  ).bind(user.id, perPage, (page - 1) * perPage).all<JoinRow>();
  const tags = await loadTags(c.env.DB, rows.results.map((row) => String(row.id)));
  const total = Number(totalRow?.total ?? 0);
  return c.json(ok({
    items: rows.results.map((row) => mapTopic(row, tags.get(String(row.id)) ?? [])),
    page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)),
  } satisfies { items: TopicSummary[]; page: number; perPage: number; total: number; totalPages: number }));
});

userRoutes.get("/api/me/topics", requireAuth, async (c) => {
  const user = c.get("user")!;
  const { page, perPage } = pageParams(c);
  return c.json(ok(await topicsByAuthor(c.env.DB, user.id, page, perPage)));
});

userRoutes.get("/api/me/replies", requireAuth, async (c) => {
  const user = c.get("user")!;
  const { page, perPage } = pageParams(c);
  return c.json(ok(await repliesByAuthor(c.env.DB, user.id, user.id, page, perPage)));
});
