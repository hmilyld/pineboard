import {
  createPostSchema,
  createTopicSchema,
  editPostSchema,
  excerpt,
  markdownToPlainText,
  pageQuerySchema,
  slugSchema,
  topicSortSchema,
  ulid,
  type AuthorSummary,
  type Post,
  type PostPage,
  type Revision,
  type Tag,
  type TopicDetail,
  type TopicList,
  type TopicSummary,
  type PostList,
} from "@pineboard/shared";
import { Hono, type Context } from "hono";
import { getSecurityConfig } from "./config";
import type { AppEnv, SessionUser } from "./env";
import { requireActive, requireAuth, requireVerified } from "./middleware/guards";
import { canDeleteContent, canEditContent, canViewHistory, isCategoryModerator } from "./permissions";
import { buildReplyNotifications, notificationStatements, sendMentionEmails } from "./notifications";
import { bigramTokens } from "@pineboard/shared";
import { ftsDeleteStatement, ftsDeleteTopicStatement, ftsInsertStatement } from "./search-index";
import { consumeRateLimit, hashIp, verifyTurnstile } from "./security";
import { getEffectiveIntegrations } from "./integrations";
import { startOfDaySeconds } from "./stats";

type JoinRow = Record<string, unknown>;

export const topicSelect = `
  SELECT t.id, fp.title AS title, t.status, t.pin_level, t.pin_order, t.is_locked, t.is_digest,
         t.reply_count, t.like_count, t.view_count, t.created_at, t.last_post_at, t.category_id,
         c.slug AS category_slug, c.name AS category_name, c.color AS category_color,
         u.id AS author_id, u.username AS author_username, u.name AS author_name, u.avatar_key AS author_avatar_key,
         lu.id AS last_user_id, lu.username AS last_user_username, lu.name AS last_user_name, lu.avatar_key AS last_user_avatar_key
    FROM topics t
    JOIN categories c ON c.id = t.category_id
    JOIN user u ON u.id = t.author_id
    LEFT JOIN user lu ON lu.id = t.last_post_user_id
    JOIN posts fp ON fp.topic_id = t.id AND fp.is_first = 1`;

function seconds(value: unknown): number {
  return Number(value ?? 0);
}

function author(row: JoinRow): AuthorSummary {
  return {
    id: String(row.author_id),
    username: (row.author_username as string | null) ?? null,
    name: String(row.author_name),
    avatarKey: (row.author_avatar_key as string | null) ?? null,
  };
}

function mapTag(row: JoinRow): Tag {
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    color: String(row.color),
    usageCount: Number(row.usage_count ?? 0),
    ...(row.description == null ? {} : { description: String(row.description) }),
    ...(row.topic_count == null ? {} : { topicCount: Number(row.topic_count) }),
    recentTopic: row.recent_topic_id
      ? { id: String(row.recent_topic_id), title: String(row.recent_topic_title ?? "") }
      : null,
  };
}

export function mapTopic(row: JoinRow, tags: Tag[] = []): TopicSummary {
  return {
    id: String(row.id),
    title: String(row.title),
    status: String(row.status),
    pinLevel: Number(row.pin_level ?? 0),
    isDigest: Number(row.is_digest ?? 0) === 1,
    isLocked: Number(row.is_locked ?? 0) === 1,
    replyCount: Number(row.reply_count ?? 0),
    likeCount: Number(row.like_count ?? 0),
    viewCount: Number(row.view_count ?? 0),
    createdAt: seconds(row.created_at),
    lastPostAt: seconds(row.last_post_at),
    category: {
      id: String(row.category_id),
      slug: String(row.category_slug),
      name: String(row.category_name),
      color: String(row.category_color ?? "#14513f"),
    },
    author: author(row),
    lastPostUser: row.last_user_id
      ? {
          id: String(row.last_user_id),
          username: (row.last_user_username as string | null) ?? null,
          name: String(row.last_user_name),
          avatarKey: (row.last_user_avatar_key as string | null) ?? null,
        }
      : null,
    tags,
  };
}

export function mapPost(row: JoinRow): Post {
  const deleted = String(row.status) === "deleted";
  return {
    id: String(row.id),
    topicId: String(row.topic_id),
    author: author(row),
    parentPostId: (row.parent_post_id as string | null) ?? null,
    floor: Number(row.floor),
    isFirst: Number(row.is_first ?? 0) === 1,
    title: (row.title as string | null) ?? null,
    contentMd: deleted ? "" : String(row.content_md ?? ""),
    contentText: deleted ? "" : String(row.content_text ?? ""),
    status: String(row.status),
    likeCount: Number(row.like_count ?? 0),
    version: Number(row.version ?? 1),
    editCount: Number(row.edit_count ?? 0),
    editedAt: row.edited_at == null ? null : seconds(row.edited_at),
    createdAt: seconds(row.created_at),
    deletedAt: row.deleted_at == null ? null : seconds(row.deleted_at),
    likedByMe: Number(row.liked_by_me ?? 0) === 1,
  };
}

export async function loadTags(db: D1Database, topicIds: string[]): Promise<Map<string, Tag[]>> {
  const result = new Map<string, Tag[]>();
  if (topicIds.length === 0) return result;
  const placeholders = topicIds.map(() => "?").join(",");
  const rows = await db
    .prepare(
      `SELECT tt.topic_id, g.id, g.slug, g.name, g.color, g.usage_count
         FROM topic_tags tt JOIN tags g ON g.id = tt.tag_id
        WHERE tt.topic_id IN (${placeholders}) AND g.status = 'active'`,
    )
    .bind(...topicIds)
    .all<JoinRow>();
  for (const row of rows.results) {
    const topicId = String(row.topic_id);
    const list = result.get(topicId) ?? [];
    list.push(mapTag(row));
    result.set(topicId, list);
  }
  return result;
}

async function categoryExists(db: D1Database, categoryId: string): Promise<{ slug: string; name: string } | null> {
  const row = await db
    .prepare("SELECT slug, name FROM categories WHERE id = ? AND is_visible = 1")
    .bind(categoryId)
    .first<{ slug: string; name: string }>();
  return row ?? null;
}

async function canModerateCategory(db: D1Database, user: SessionUser, categoryId: string): Promise<boolean> {
  if (user.role === "admin") return true;
  if (user.role !== "moderator") return false;
  const row = await db
    .prepare("SELECT 1 AS ok FROM category_moderators WHERE category_id = ? AND user_id = ?")
    .bind(categoryId, user.id)
    .first<{ ok: number }>();
  return row?.ok === 1;
}

function zodFields(error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> }): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "body";
    (fields[key] ??= []).push(issue.message);
  }
  return fields;
}

async function writeTurnstile(c: { env: AppEnv["Bindings"]; req: { header(name: string): string | undefined } }, config: { site: { url: string }; feature: { turnstile: boolean } }, action: string) {
  if (!config.feature.turnstile) return { ok: true as const };
  const token = c.req.header("x-turnstile-token") ?? c.req.header("cf-turnstile-response");
  const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const integration = await getEffectiveIntegrations(c.env);
  // Without a Site Key the widget cannot render; do not ask users to complete an invisible challenge.
  if (!integration.cloudflare.turnstileSiteKey) return { ok: true as const };
  return verifyTurnstile({
    secret: integration.secrets.turnstileSecret,
    token,
    ip,
    action,
    expectedHostnames: [...new Set([new URL(config.site.url).hostname, new URL(c.env.SITE_URL).hostname])],
  });
}

async function postingLimits(
  c: { env: AppEnv["Bindings"]; req: { header(name: string): string | undefined } },
  user: SessionUser,
  config: Awaited<ReturnType<typeof getSecurityConfig>>["config"],
  action: "topic_create" | "post_create",
) {
  if (config.security.postMinIntervalSeconds > 0) {
    const limit = await consumeRateLimit(
      c.env,
      `post:${user.id}:${action}`,
      config.security.postMinIntervalSeconds,
      1,
    );
    if (!limit.allowed) return { ok: false as const, retryAfter: limit.retryAfter };
  }
  if (Date.now() - user.createdAt.getTime() < 24 * 60 * 60 * 1000) {
    const daily = await consumeRateLimit(c.env, `newuser-posts:${user.id}`, 86400, config.security.newUserDailyPosts);
    if (!daily.allowed) return { ok: false as const, retryAfter: daily.retryAfter };
  }
  return { ok: true as const };
}

export const forumRoutes = new Hono<AppEnv>();

const categoryStatsSql = `(SELECT COUNT(*) FROM topics t WHERE t.category_id = c.id AND t.status = 'published') AS topic_count,
  (SELECT COUNT(*) FROM topics t WHERE t.category_id = c.id AND t.status = 'published' AND t.created_at >= ?) AS today_topics,
  (SELECT COUNT(*) FROM posts p JOIN topics t ON t.id = p.topic_id
    WHERE t.category_id = c.id AND t.status = 'published' AND p.is_first = 0 AND p.status = 'published') AS replies,
  (SELECT t.id FROM topics t WHERE t.category_id = c.id AND t.status = 'published' ORDER BY t.last_post_at DESC LIMIT 1) AS recent_topic_id,
  (SELECT fp.title FROM topics t JOIN posts fp ON fp.topic_id = t.id AND fp.is_first = 1
    WHERE t.category_id = c.id AND t.status = 'published' ORDER BY t.last_post_at DESC LIMIT 1) AS recent_topic_title`;

forumRoutes.get("/api/categories", async (c) => {
  const today = startOfDaySeconds(c.get("config").site.timezone);
  const result = await c.env.DB.prepare(
    `SELECT c.id, c.slug, c.name, c.description, c.color, c.sort_order, c.is_visible, ${categoryStatsSql}
       FROM categories c WHERE c.is_visible = 1 ORDER BY c.sort_order, c.name`,
  ).bind(today).all<JoinRow>();
  return c.json({ ok: true, data: result.results.map((row) => ({
    id: String(row.id), slug: String(row.slug), name: String(row.name),
    description: String(row.description ?? ""), color: String(row.color ?? "#14513f"), sortOrder: Number(row.sort_order ?? 0),
    isVisible: Number(row.is_visible ?? 0) === 1, topicCount: Number(row.topic_count ?? 0),
    todayTopics: Number(row.today_topics ?? 0), replies: Number(row.replies ?? 0),
    stats: { topics: Number(row.topic_count ?? 0), todayTopics: Number(row.today_topics ?? 0), replies: Number(row.replies ?? 0) },
    recentTopic: row.recent_topic_id ? { id: String(row.recent_topic_id), title: String(row.recent_topic_title ?? "") } : null,
  })) });
});

forumRoutes.get("/api/categories/:slug", async (c) => {
  const today = startOfDaySeconds(c.get("config").site.timezone);
  const row = await c.env.DB.prepare(
    `SELECT c.id, c.slug, c.name, c.description, c.color, c.sort_order, c.is_visible, ${categoryStatsSql}
       FROM categories c WHERE c.slug = ? AND c.is_visible = 1`,
  ).bind(today, c.req.param("slug")).first<JoinRow>();
  if (!row) return c.json({ ok: false, error: { code: "not_found", message: "版块不存在" } }, 404);
  return c.json({ ok: true, data: {
    id: String(row.id), slug: String(row.slug), name: String(row.name),
    description: String(row.description ?? ""), color: String(row.color ?? "#14513f"), sortOrder: Number(row.sort_order ?? 0),
    isVisible: Number(row.is_visible ?? 0) === 1, topicCount: Number(row.topic_count ?? 0),
    todayTopics: Number(row.today_topics ?? 0), replies: Number(row.replies ?? 0),
    stats: { topics: Number(row.topic_count ?? 0), todayTopics: Number(row.today_topics ?? 0), replies: Number(row.replies ?? 0) },
    recentTopic: row.recent_topic_id ? { id: String(row.recent_topic_id), title: String(row.recent_topic_title ?? "") } : null,
  } });
});

forumRoutes.get("/api/tags", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT g.id, g.slug, g.name, g.description, g.color,
            (SELECT COUNT(*) FROM topic_tags tt JOIN topics t ON t.id = tt.topic_id
              WHERE tt.tag_id = g.id AND t.status = 'published') AS usage_count,
            (SELECT COUNT(*) FROM topic_tags tt JOIN topics t ON t.id = tt.topic_id
              WHERE tt.tag_id = g.id AND t.status = 'published') AS topic_count,
            (SELECT t.id FROM topic_tags tt JOIN topics t ON t.id = tt.topic_id
              WHERE tt.tag_id = g.id AND t.status = 'published' ORDER BY t.last_post_at DESC LIMIT 1) AS recent_topic_id,
            (SELECT fp.title FROM topic_tags tt JOIN topics t ON t.id = tt.topic_id
              JOIN posts fp ON fp.topic_id = t.id AND fp.is_first = 1
              WHERE tt.tag_id = g.id AND t.status = 'published' ORDER BY t.last_post_at DESC LIMIT 1) AS recent_topic_title
       FROM tags g WHERE g.status = 'active'
      ORDER BY (SELECT COUNT(*) FROM topic_tags tt JOIN topics t ON t.id = tt.topic_id
                 WHERE tt.tag_id = g.id AND t.status = 'published') DESC, g.name`,
  ).all<JoinRow>();
  return c.json({ ok: true, data: rows.results.map(mapTag) });
});

forumRoutes.get("/api/tags/:slug", async (c) => {
  const today = startOfDaySeconds(c.get("config").site.timezone);
  const row = await c.env.DB.prepare(
    `SELECT g.id, g.slug, g.name, g.description, g.color,
            (SELECT COUNT(*) FROM topic_tags tt JOIN topics t ON t.id = tt.topic_id
              WHERE tt.tag_id = g.id AND t.status = 'published') AS usage_count,
            (SELECT COUNT(*) FROM topic_tags tt JOIN topics t ON t.id = tt.topic_id
              WHERE tt.tag_id = g.id AND t.status = 'published') AS topic_count,
            (SELECT COUNT(*) FROM topic_tags tt JOIN topics t ON t.id = tt.topic_id
              WHERE tt.tag_id = g.id AND t.status = 'published' AND t.created_at >= ?) AS today_topics,
            (SELECT COUNT(*) FROM topic_tags tt JOIN topics t ON t.id = tt.topic_id
              JOIN posts p ON p.topic_id = t.id AND p.is_first = 0 AND p.status = 'published'
              WHERE tt.tag_id = g.id AND t.status = 'published') AS replies
       FROM tags g WHERE g.slug = ? AND g.status = 'active'`,
  ).bind(today, c.req.param("slug")).first<JoinRow>();
  if (!row) return c.json({ ok: false, error: { code: "not_found", message: "标签不存在" } }, 404);
  const tag = mapTag(row);
  return c.json({ ok: true, data: {
    ...tag,
    description: String(row.description ?? "") || `关于 #${String(row.name)} 的主题`,
    stats: { topics: Number(row.topic_count ?? 0), todayTopics: Number(row.today_topics ?? 0), replies: Number(row.replies ?? 0) },
  } });
});

forumRoutes.get("/api/topics", async (c) => {
  const parsedPage = pageQuerySchema.safeParse({
    page: c.req.query("page") ?? "1",
    perPage: c.req.query("perPage") ?? "20",
  });
  if (!parsedPage.success) return c.json({ ok: false, error: { code: "validation_error", message: "分页参数不合法", fields: zodFields(parsedPage.error) } }, 400);
  const sort = topicSortSchema.safeParse(c.req.query("sort") ?? "latest");
  if (!sort.success) return c.json({ ok: false, error: { code: "validation_error", message: "排序参数不合法" } }, 400);
  const { page, perPage } = parsedPage.data;
  const category = c.req.query("category")?.trim();
  const tag = c.req.query("tag")?.trim();
  const digest = c.req.query("digest") === "1";

  const where: string[] = ["t.status = 'published'", "c.is_visible = 1"];
  if (digest) where.push("t.is_digest = 1");
  const binds: unknown[] = [];
  if (category) {
    where.push("(c.slug = ? OR c.id = ?)");
    binds.push(category, category);
  }
  if (tag) {
    where.push("EXISTS (SELECT 1 FROM topic_tags tt JOIN tags g ON g.id = tt.tag_id WHERE tt.topic_id = t.id AND g.slug = ? AND g.status = 'active')");
    binds.push(tag);
  }
  const whereSql = where.join(" AND ");
  const countRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total FROM topics t JOIN categories c ON c.id = t.category_id WHERE ${whereSql}`,
  ).bind(...binds).first<{ total: number }>();
  const total = Number(countRow?.total ?? 0);
  const order = sort.data === "new"
    ? "t.created_at DESC"
    : sort.data === "hot"
      ? "(t.reply_count * 2 + t.like_count * 3) DESC, t.last_post_at DESC"
      : "t.pin_level DESC, t.pin_order ASC, t.last_post_at DESC";
  const rows = await c.env.DB.prepare(
    `${topicSelect} WHERE ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`,
  ).bind(...binds, perPage, (page - 1) * perPage).all<JoinRow>();
  const tags = await loadTags(c.env.DB, rows.results.map((row) => String(row.id)));
  const data: TopicList = {
    items: rows.results.map((row) => mapTopic(row, tags.get(String(row.id)) ?? [])),
    page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)),
  };
  return c.json({ ok: true, data });
});

forumRoutes.get("/api/topics/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    `SELECT t.id, t.status, t.pin_level, t.pin_order, t.is_locked, t.is_digest, t.reply_count, t.like_count,
            t.view_count, t.created_at, t.last_post_at, t.category_id,
            c.slug AS category_slug, c.name AS category_name, c.color AS category_color,
            u.id AS author_id, u.username AS author_username, u.name AS author_name, u.avatar_key AS author_avatar_key,
            lu.id AS last_user_id, lu.username AS last_user_username, lu.name AS last_user_name, lu.avatar_key AS last_user_avatar_key
       FROM topics t JOIN categories c ON c.id = t.category_id JOIN user u ON u.id = t.author_id
       LEFT JOIN user lu ON lu.id = t.last_post_user_id
      WHERE t.id = ? AND t.status = 'published' AND c.is_visible = 1`,
  ).bind(id).first<JoinRow>();
  if (!row) return c.json({ ok: false, error: { code: "not_found", message: "主题不存在" } }, 404);
  const firstPostRow = await c.env.DB.prepare(
    `SELECT p.*, u.id AS author_id, u.username AS author_username, u.name AS author_name, u.avatar_key AS author_avatar_key,
            EXISTS (SELECT 1 FROM post_likes pl WHERE pl.post_id = p.id AND pl.user_id = ?) AS liked_by_me
       FROM posts p JOIN user u ON u.id = p.author_id
      WHERE p.topic_id = ? AND p.is_first = 1 LIMIT 1`,
  ).bind(c.get("user")?.id ?? "", id).first<JoinRow>();
  if (!firstPostRow) return c.json({ ok: false, error: { code: "not_found", message: "首帖不存在" } }, 404);
  const tags = (await loadTags(c.env.DB, [id])).get(id) ?? [];
  const user = c.get("user");
  const bookmarked = user
    ? Boolean(await c.env.DB.prepare("SELECT 1 AS ok FROM bookmarks WHERE user_id = ? AND topic_id = ?").bind(user.id, id).first())
    : false;
  const moderator = user ? await isCategoryModerator(c.env.DB, user, String(row.category_id)) : false;
  const canReply = Boolean(user && user.status === "active" && !Number(row.is_locked) && (user.emailVerified || !c.get("config").account.requireVerificationForWrite));
  const canDelete = user
    ? await canDeleteContent({
        db: c.env.DB,
        user,
        config: c.get("config"),
        categoryId: String(row.category_id),
        authorId: String(row.author_id),
      })
    : false;
  const firstPostForEdit = {
    authorId: String(firstPostRow.author_id),
    createdAt: new Date(seconds(firstPostRow.created_at) * 1000),
    status: String(firstPostRow.status),
  };
  const editDecision = user
    ? await canEditContent({
        db: c.env.DB,
        user,
        config: c.get("config"),
        categoryId: String(row.category_id),
        post: firstPostForEdit,
        topic: { replyCount: Number(row.reply_count ?? 0), status: String(row.status) },
        isFirst: true,
      })
    : { allowed: false as const };
  const historyAllowed = await canViewHistory({
    db: c.env.DB,
    user,
    config: c.get("config"),
    categoryId: String(row.category_id),
    authorId: String(firstPostRow.author_id),
  });
  const data: TopicDetail = {
    topic: mapTopic({ ...row, title: firstPostRow.title ?? row.title }, tags),
    firstPost: mapPost(firstPostRow),
    viewer: {
      canReply,
      canEdit: editDecision.allowed,
      canDelete,
      canModerate: Boolean(user && (user.role === "admin" || moderator)),
      canViewHistory: historyAllowed,
      liked: Number(firstPostRow.liked_by_me ?? 0) === 1,
      bookmarked,
    },
  };
  return c.json({ ok: true, data });
});

forumRoutes.get("/api/topics/:id/posts", async (c) => {
  const id = c.req.param("id");
  const topic = await c.env.DB.prepare("SELECT id, author_id FROM topics WHERE id = ? AND status = 'published'").bind(id).first<{ id: string; author_id: string }>();
  if (!topic) return c.json({ ok: false, error: { code: "not_found", message: "主题不存在" } }, 404);
  const onlyOp = c.req.query("onlyOp") === "1";
  const pageMode = c.req.query("page") !== undefined || c.req.query("onlyOp") !== undefined;
  const perPageRaw = Number(c.req.query("perPage") ?? c.get("config").seo.postsPerPage);
  const perPage = Number.isFinite(perPageRaw) ? Math.min(50, Math.max(5, Math.floor(perPageRaw))) : c.get("config").seo.postsPerPage;

  if (!pageMode && c.req.query("after") !== undefined) {
    const afterRaw = Number(c.req.query("after") ?? 0);
    const after = Number.isFinite(afterRaw) && afterRaw >= 0 ? Math.floor(afterRaw) : 0;
    const rows = await c.env.DB.prepare(
      `SELECT p.*, u.id AS author_id, u.username AS author_username, u.name AS author_name, u.avatar_key AS author_avatar_key,
              EXISTS (SELECT 1 FROM post_likes pl WHERE pl.post_id = p.id AND pl.user_id = ?) AS liked_by_me
         FROM posts p JOIN user u ON u.id = p.author_id
        WHERE p.topic_id = ? AND p.is_first = 0 AND p.floor > ? AND p.status IN ('published','deleted')
        ORDER BY p.floor ASC LIMIT ?`,
    ).bind(c.get("user")?.id ?? "", id, after, perPage + 1).all<JoinRow>();
    const hasMore = rows.results.length > perPage;
    const items = rows.results.slice(0, perPage).map(mapPost);
    return c.json({ ok: true, data: { items, nextCursor: hasMore ? items[items.length - 1]?.floor ?? null : null } });
  }

  const pageRaw = Number(c.req.query("page") ?? 1);
  const page = Number.isFinite(pageRaw) ? Math.max(1, Math.min(10_000, Math.floor(pageRaw))) : 1;
  const totalRow = onlyOp
    ? await c.env.DB.prepare(
        `SELECT COUNT(*) AS total FROM posts
          WHERE topic_id = ? AND status IN ('published','deleted') AND (is_first = 1 OR author_id = ?)`,
      ).bind(id, topic.author_id).first<{ total: number }>()
    : await c.env.DB.prepare(
        "SELECT COUNT(*) AS total FROM posts WHERE topic_id = ? AND status IN ('published','deleted')",
      ).bind(id).first<{ total: number }>();
  const total = Number(totalRow?.total ?? 0);
  const limit = page === 1 ? Math.max(1, perPage - 1) : perPage;
  const offset = page === 1 ? 0 : Math.max(0, (page - 1) * perPage - 1);
  const authorFilter = onlyOp ? " AND p.author_id = ?" : "";
  const binds: unknown[] = [c.get("user")?.id ?? "", id];
  if (onlyOp) binds.push(topic.author_id);
  binds.push(limit, offset);
  const rows = await c.env.DB.prepare(
    `SELECT p.*, u.id AS author_id, u.username AS author_username, u.name AS author_name, u.avatar_key AS author_avatar_key,
            EXISTS (SELECT 1 FROM post_likes pl WHERE pl.post_id = p.id AND pl.user_id = ?) AS liked_by_me
       FROM posts p JOIN user u ON u.id = p.author_id
      WHERE p.topic_id = ? AND p.is_first = 0 AND p.status IN ('published','deleted')${authorFilter}
      ORDER BY p.floor ASC LIMIT ? OFFSET ?`,
  ).bind(...binds).all<JoinRow>();
  const data: PostPage = {
    items: rows.results.map(mapPost),
    page,
    perPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
    onlyOp,
    nextCursor: null,
  };
  return c.json({ ok: true, data });
});

forumRoutes.post("/api/topics", requireVerified, async (c) => {
  const user = c.get("user")!;
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ ok: false, error: { code: "validation_error", message: "请求体必须是 JSON" } }, 400); }
  const parsed = createTopicSchema.safeParse(body);
  if (!parsed.success) return c.json({ ok: false, error: { code: "validation_error", message: "请检查表单", fields: zodFields(parsed.error) } }, 400);
  const category = await categoryExists(c.env.DB, parsed.data.categoryId);
  if (!category) return c.json({ ok: false, error: { code: "not_found", message: "版块不存在" } }, 404);
  const tagIds = [...new Set(parsed.data.tagIds)];
  if (tagIds.length) {
    const rows = await c.env.DB.prepare(
      `SELECT id FROM tags WHERE status = 'active' AND id IN (${tagIds.map(() => "?").join(",")})`,
    ).bind(...tagIds).all<{ id: string }>();
    if (rows.results.length !== tagIds.length) return c.json({ ok: false, error: { code: "validation_error", message: "包含不可用标签" } }, 400);
  }
  const security = await getSecurityConfig(c.env);
  const limits = await postingLimits(c, user, security.config, "topic_create");
  if (!limits.ok) {
    c.header("retry-after", String(limits.retryAfter));
    return c.json({ ok: false, error: { code: "rate_limited", message: "发帖过于频繁" } }, 429);
  }
  const captcha = await writeTurnstile(c, security.config, "topic_create");
  if (!captcha.ok) return c.json({ ok: false, error: { code: captcha.code, message: captcha.message } }, captcha.code === "captcha_unavailable" ? 503 : 400);

  const now = Math.floor(Date.now() / 1000);
  const topicId = ulid();
  const postId = ulid();
  const contentText = markdownToPlainText(parsed.data.contentMd).slice(0, 100_000);
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `INSERT INTO topics (id, category_id, author_id, first_post_id, status, pin_level, pin_order, is_locked,
         reply_count, like_count, view_count, last_post_at, last_post_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'published', 0, 0, 0, 0, 0, 0, ?, ?, ?, ?)`,
    ).bind(topicId, parsed.data.categoryId, user.id, postId, now, user.id, now, now),
    c.env.DB.prepare(
      `INSERT INTO posts (id, topic_id, author_id, floor, is_first, title, content_md, content_text, status,
         like_count, version, edit_count, created_at, updated_at)
       VALUES (?, ?, ?, 1, 1, ?, ?, ?, 'published', 0, 1, 0, ?, ?)`,
    ).bind(postId, topicId, user.id, parsed.data.title, parsed.data.contentMd, contentText, now, now),
    ftsInsertStatement(c.env.DB, { postId, topicId, title: parsed.data.title, content: parsed.data.contentMd }),
  ];
  for (const tagId of tagIds) {
    statements.push(c.env.DB.prepare("INSERT INTO topic_tags (topic_id, tag_id) VALUES (?, ?)").bind(topicId, tagId));
  }
  for (const tagId of tagIds) {
    statements.push(c.env.DB.prepare("UPDATE tags SET usage_count = usage_count + 1 WHERE id = ?").bind(tagId));
  }
  statements.push(c.env.DB.prepare(
    `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, meta_json, ip_hash, created_at)
     VALUES (?, ?, 'topic.create', 'topic', ?, ?, ?, ?)`,
  ).bind(ulid(), user.id, topicId, JSON.stringify({ categoryId: parsed.data.categoryId }), await hashIp(c.env, c.req.header("cf-connecting-ip") ?? "unknown"), now));
  await c.env.DB.batch(statements);
  return c.json({ ok: true, data: { id: topicId, postId } }, 201);
});

forumRoutes.post("/api/topics/:id/posts", requireVerified, async (c) => {
  const user = c.get("user")!;
  const topicId = c.req.param("id");
  const topic = await c.env.DB.prepare(
    `SELECT t.id, t.is_locked, t.status, t.author_id,
            (SELECT fp.title FROM posts fp WHERE fp.topic_id = t.id AND fp.is_first = 1 LIMIT 1) AS topic_title
       FROM topics t WHERE t.id = ? AND t.status = 'published'`,
  ).bind(topicId).first<{ id: string; is_locked: number; status: string; author_id: string; topic_title: string | null }>();
  if (!topic) return c.json({ ok: false, error: { code: "not_found", message: "主题不存在" } }, 404);
  if (Number(topic.is_locked)) return c.json({ ok: false, error: { code: "forbidden", message: "主题已锁定" } }, 403);
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ ok: false, error: { code: "validation_error", message: "请求体必须是 JSON" } }, 400); }
  const parsed = createPostSchema.safeParse(body);
  if (!parsed.success) return c.json({ ok: false, error: { code: "validation_error", message: "请检查回复", fields: zodFields(parsed.error) } }, 400);
  if (parsed.data.parentPostId) {
    const parent = await c.env.DB.prepare("SELECT id, parent_post_id, status FROM posts WHERE id = ? AND topic_id = ?").bind(parsed.data.parentPostId, topicId).first<{ id: string; parent_post_id: string | null; status: string }>();
    if (!parent || parent.status === "deleted") return c.json({ ok: false, error: { code: "validation_error", message: "被回复的楼层不存在" } }, 400);
    if (parent.parent_post_id) return c.json({ ok: false, error: { code: "validation_error", message: "楼中楼最多两层" } }, 400);
  }
  const security = await getSecurityConfig(c.env);
  const limits = await postingLimits(c, user, security.config, "post_create");
  if (!limits.ok) {
    c.header("retry-after", String(limits.retryAfter));
    return c.json({ ok: false, error: { code: "rate_limited", message: "回复过于频繁" } }, 429);
  }
  const captcha = await writeTurnstile(c, security.config, "post_create");
  if (!captcha.ok) return c.json({ ok: false, error: { code: captcha.code, message: captcha.message } }, captcha.code === "captcha_unavailable" ? 503 : 400);

  const now = Math.floor(Date.now() / 1000);
  const postId = ulid();
  const contentText = markdownToPlainText(parsed.data.contentMd).slice(0, 100_000);
  const notifications = await buildReplyNotifications(c.env.DB, {
    topicId,
    topicAuthorId: topic.author_id,
    parentPostId: parsed.data.parentPostId,
    actorId: user.id,
    postId,
    title: topic.topic_title ?? "新回复",
    snippet: excerpt(parsed.data.contentMd, 120),
    contentMd: parsed.data.contentMd,
    mentionMax: c.get("config").security.mentionMaxPerPost,
  });
  let insertResult: D1Result;
  try {
    const results = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO posts (id, topic_id, author_id, parent_post_id, floor, is_first, title, content_md, content_text,
           status, like_count, version, edit_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(floor), 0) + 1 FROM posts WHERE topic_id = ?), 0, NULL, ?, ?, 'published', 0, 1, 0, ?, ?)
         RETURNING floor`,
      ).bind(postId, topicId, user.id, parsed.data.parentPostId ?? null, topicId, parsed.data.contentMd, contentText, now, now),
      c.env.DB.prepare(
        "UPDATE topics SET reply_count = reply_count + 1, last_post_at = ?, last_post_user_id = ?, updated_at = ? WHERE id = ? AND status = 'published'",
      ).bind(now, user.id, now, topicId),
      c.env.DB.prepare(
        `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, meta_json, ip_hash, created_at)
         VALUES (?, ?, 'post.create', 'topic', ?, NULL, ?, ?)`,
      ).bind(ulid(), user.id, topicId, await hashIp(c.env, c.req.header("cf-connecting-ip") ?? "unknown"), now),
      ftsInsertStatement(c.env.DB, { postId, topicId, title: "", content: parsed.data.contentMd }),
      ...notificationStatements(c.env.DB, notifications),
    ]);
    insertResult = results[0]!;
  } catch (error) {
    return c.json({ ok: false, error: { code: "conflict", message: error instanceof Error && /UNIQUE/.test(error.message) ? "楼层冲突，请重试" : "回复失败" } }, 409);
  }
  const floor = Number((insertResult.results[0] as { floor?: number } | undefined)?.floor ?? 0);
  if (notifications.some((item) => item.type === "mention")) {
    c.executionCtx.waitUntil(sendMentionEmails(c.env, c.get("config"), notifications));
  }
  return c.json({ ok: true, data: { id: postId, floor } }, 201);
});

async function applyPostEdit(
  c: Context<AppEnv>,
  input: { topicId: string; postId: string },
) {
  const user = c.get("user")!;
  const config = c.get("config");
  const row = await c.env.DB.prepare(
    `SELECT p.id, p.topic_id, p.author_id, p.version, p.status, p.is_first, p.title, p.content_md, p.created_at,
            t.category_id, t.status AS topic_status, t.reply_count
       FROM posts p JOIN topics t ON t.id = p.topic_id
      WHERE p.id = ? AND p.topic_id = ?`,
  ).bind(input.postId, input.topicId).first<JoinRow>();
  if (!row) return c.json({ ok: false, error: { code: "not_found", message: "内容不存在" } }, 404);
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ ok: false, error: { code: "validation_error", message: "请求体必须是 JSON" } }, 400); }
  const parsed = editPostSchema.safeParse(body);
  if (!parsed.success) return c.json({ ok: false, error: { code: "validation_error", message: "请检查编辑内容", fields: zodFields(parsed.error) } }, 400);
  const isFirst = Number(row.is_first) === 1;
  if (!isFirst && parsed.data.title !== undefined) {
    return c.json({ ok: false, error: { code: "validation_error", message: "回复不能设置标题" } }, 400);
  }
  if (config.edit.requireReason && !parsed.data.reason?.trim()) {
    return c.json({ ok: false, error: { code: "validation_error", message: "请填写编辑原因", fields: { reason: ["请填写编辑原因"] } } }, 400);
  }
  const decision = await canEditContent({
    db: c.env.DB,
    user,
    config,
    categoryId: String(row.category_id),
    post: { authorId: String(row.author_id), createdAt: new Date(seconds(row.created_at) * 1000), status: String(row.status) },
    topic: { replyCount: Number(row.reply_count ?? 0), status: String(row.topic_status) },
    isFirst,
  });
  if (!decision.allowed) return c.json({ ok: false, error: { code: decision.code, message: decision.message } }, 403);

  const now = Math.floor(Date.now() / 1000);
  const contentText = parsed.data.contentMd !== undefined ? markdownToPlainText(parsed.data.contentMd).slice(0, 100_000) : null;
  let updateResult: D1Result;
  try {
    const results = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO post_revisions (id, topic_id, post_id, version, title, content_md, action, editor_id, reason, created_at)
         SELECT ?, p.topic_id, p.id, p.version, p.title, p.content_md, 'edit', ?, ?, ?
           FROM posts p WHERE p.id = ? AND p.version = ?`,
      ).bind(ulid(), user.id, parsed.data.reason?.trim() || null, now, input.postId, parsed.data.version),
      c.env.DB.prepare(
        `UPDATE posts SET title = CASE WHEN ? IS NULL THEN title ELSE ? END,
                content_md = CASE WHEN ? IS NULL THEN content_md ELSE ? END,
                content_text = CASE WHEN ? IS NULL THEN content_text ELSE ? END,
                version = version + 1, edit_count = edit_count + 1, edited_at = ?, updated_at = ?
          WHERE id = ? AND version = ?`,
      ).bind(
        parsed.data.title ?? null, parsed.data.title ?? null,
        parsed.data.contentMd ?? null, parsed.data.contentMd ?? null,
        contentText, contentText,
        now, now, input.postId, parsed.data.version,
      ),
      // Every following statement is guarded by the *new* version. A stale CAS
      // update must leave the topic timestamp, FTS rows and audit log untouched.
      c.env.DB.prepare(
        "UPDATE topics SET updated_at = ? WHERE id = ? AND EXISTS (SELECT 1 FROM posts WHERE id = ? AND version = ?)",
      ).bind(now, input.topicId, input.postId, parsed.data.version + 1),
      c.env.DB.prepare(
        "DELETE FROM post_search WHERE post_uid = ? AND EXISTS (SELECT 1 FROM posts WHERE id = ? AND version = ?)",
      ).bind(input.postId, input.postId, parsed.data.version + 1),
      c.env.DB.prepare(
        `INSERT INTO post_search (post_uid, topic_id, title, tokens)
         SELECT ?, p.topic_id, ?, ? FROM posts p WHERE p.id = ? AND p.version = ?`,
      ).bind(
        input.postId,
        isFirst ? String(parsed.data.title ?? row.title ?? "") : "",
        bigramTokens(`${isFirst ? String(parsed.data.title ?? row.title ?? "") : ""} ${parsed.data.contentMd ?? String(row.content_md ?? "")}`),
        input.postId,
        parsed.data.version + 1,
      ),
      c.env.DB.prepare(
        `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, meta_json, ip_hash, created_at)
         SELECT ?, ?, 'post.edit', 'post', ?, ?, NULL, ?
          WHERE EXISTS (SELECT 1 FROM posts WHERE id = ? AND version = ?)`,
      ).bind(ulid(), user.id, input.postId, JSON.stringify({ version: parsed.data.version, reason: parsed.data.reason ?? null }), now, input.postId, parsed.data.version + 1),
      c.env.DB.prepare(
        `DELETE FROM post_revisions WHERE post_id = ? AND EXISTS (SELECT 1 FROM posts WHERE id = ? AND version = ?)
           AND id NOT IN (SELECT id FROM post_revisions WHERE post_id = ? ORDER BY version DESC LIMIT ?)`,
      ).bind(input.postId, input.postId, parsed.data.version + 1, input.postId, config.edit.keepRevisions),
    ]);
    updateResult = results[1]!;
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      route: "post.edit",
      postId: input.postId,
      message: error instanceof Error ? error.message : String(error),
    }));
    return c.json({ ok: false, error: { code: "conflict", message: "编辑冲突，请刷新后重试" } }, 409);
  }
  if (Number(updateResult.meta.changes) === 0) {
    return c.json({ ok: false, error: { code: "version_conflict", message: "内容已被修改，请刷新后重试" } }, 409);
  }
  return c.json({ ok: true, data: { version: parsed.data.version + 1 } });
}

forumRoutes.patch("/api/topics/:id", requireVerified, async (c) => {
  const first = await c.env.DB.prepare("SELECT id FROM posts WHERE topic_id = ? AND is_first = 1").bind(c.req.param("id")).first<{ id: string }>();
  if (!first) return c.json({ ok: false, error: { code: "not_found", message: "主题不存在" } }, 404);
  return applyPostEdit(c, { topicId: c.req.param("id"), postId: first.id });
});

forumRoutes.patch("/api/posts/:id", requireVerified, async (c) => {
  const post = await c.env.DB.prepare("SELECT topic_id FROM posts WHERE id = ?").bind(c.req.param("id")).first<{ topic_id: string }>();
  if (!post) return c.json({ ok: false, error: { code: "not_found", message: "回复不存在" } }, 404);
  return applyPostEdit(c, { topicId: post.topic_id, postId: c.req.param("id") });
});

forumRoutes.get("/api/topics/:id/revisions", async (c) => {
  const topicId = c.req.param("id");
  const topic = await c.env.DB.prepare("SELECT id, category_id, author_id, status FROM topics WHERE id = ?").bind(topicId).first<{ id: string; category_id: string; author_id: string; status: string }>();
  if (!topic) return c.json({ ok: false, error: { code: "not_found", message: "主题不存在" } }, 404);
  const historyUser = c.get("user");
  if (topic.status !== "published") {
    const staff = historyUser ? await isCategoryModerator(c.env.DB, historyUser, topic.category_id) : false;
    const allowedStatus = Boolean(historyUser && (historyUser.role === "admin" || staff || historyUser.id === topic.author_id));
    if (!allowedStatus) return c.json({ ok: false, error: { code: "not_found", message: "主题不存在" } }, 404);
  }
  const requestedPostId = c.req.query("postId");
  const post = requestedPostId
    ? await c.env.DB.prepare("SELECT id, author_id FROM posts WHERE id = ? AND topic_id = ?").bind(requestedPostId, topicId).first<{ id: string; author_id: string }>()
    : await c.env.DB.prepare("SELECT id, author_id FROM posts WHERE topic_id = ? AND is_first = 1").bind(topicId).first<{ id: string; author_id: string }>();
  if (!post) return c.json({ ok: false, error: { code: "not_found", message: "内容不存在" } }, 404);
  const allowed = await canViewHistory({
    db: c.env.DB,
    user: c.get("user"),
    config: c.get("config"),
    categoryId: topic.category_id,
    authorId: post.author_id,
  });
  if (!allowed) return c.json({ ok: false, error: { code: "forbidden", message: "无权查看编辑历史" } }, 403);
  const rows = await c.env.DB.prepare(
    `SELECT r.id, r.version, r.title, r.content_md, r.action, r.reason, r.created_at,
            u.id AS editor_id, u.name AS editor_name, u.username AS editor_username
       FROM post_revisions r JOIN user u ON u.id = r.editor_id
      WHERE r.post_id = ? ORDER BY r.version DESC LIMIT 100`,
  ).bind(post.id).all<JoinRow>();
  const items: Revision[] = rows.results.map((row) => ({
    id: String(row.id),
    version: Number(row.version),
    title: (row.title as string | null) ?? null,
    contentMd: String(row.content_md),
    action: String(row.action) as Revision["action"],
    editor: { id: String(row.editor_id), name: String(row.editor_name), username: (row.editor_username as string | null) ?? null },
    reason: (row.reason as string | null) ?? null,
    createdAt: seconds(row.created_at),
  }));
  return c.json({ ok: true, data: items });
});

forumRoutes.delete("/api/topics/:id", requireAuth, requireActive, async (c) => {
  const user = c.get("user")!;
  const topic = await c.env.DB.prepare("SELECT id, author_id, category_id, status, first_post_id FROM topics WHERE id = ? AND status = 'published'")
    .bind(c.req.param("id")).first<{ id: string; author_id: string; category_id: string; status: string; first_post_id: string | null }>();
  if (!topic) return c.json({ ok: false, error: { code: "not_found", message: "主题不存在" } }, 404);
  const allowed = await canDeleteContent({
    db: c.env.DB,
    user,
    config: c.get("config"),
    categoryId: topic.category_id,
    authorId: topic.author_id,
  });
  if (!allowed) return c.json({ ok: false, error: { code: "forbidden", message: "无权删除该主题" } }, 403);
  const now = Math.floor(Date.now() / 1000);
  const topicPosts = await c.env.DB.prepare(
    "SELECT id, version, title, content_md FROM posts WHERE topic_id = ?",
  ).bind(topic.id).all<{ id: string; version: number; title: string | null; content_md: string }>();
  const snapshots = topicPosts.results.map((post) =>
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO post_revisions (id, topic_id, post_id, version, title, content_md, action, editor_id, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'delete', ?, NULL, ?)`,
    ).bind(ulid(), topic.id, post.id, post.version, post.title, post.content_md, user.id, now),
  );
  for (let index = 0; index < snapshots.length; index += 50) {
    await c.env.DB.batch(snapshots.slice(index, index + 50));
  }
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE topics SET status = 'deleted', deleted_at = ?, deleted_by = ?, updated_at = ? WHERE id = ?").bind(now, user.id, now, topic.id),
    c.env.DB.prepare("UPDATE posts SET status = 'deleted', deleted_at = ?, deleted_by = ?, updated_at = ? WHERE topic_id = ?").bind(now, user.id, now, topic.id),
    ftsDeleteTopicStatement(c.env.DB, topic.id),
    c.env.DB.prepare(
      `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, meta_json, ip_hash, created_at)
       VALUES (?, ?, 'topic.delete', 'topic', ?, ?, NULL, ?)`,
    ).bind(ulid(), user.id, topic.id, JSON.stringify({ firstPostId: topic.first_post_id }), now),
  ]);
  return c.json({ ok: true, data: { deleted: true } });
});

forumRoutes.delete("/api/posts/:id", requireAuth, requireActive, async (c) => {
  const user = c.get("user")!;
  const post = await c.env.DB.prepare(
    `SELECT p.id, p.topic_id, p.author_id, p.is_first, p.status, t.category_id
       FROM posts p JOIN topics t ON t.id = p.topic_id WHERE p.id = ?`,
  ).bind(c.req.param("id")).first<{ id: string; topic_id: string; author_id: string; is_first: number; status: string; category_id: string }>();
  if (!post || post.status === "deleted") return c.json({ ok: false, error: { code: "not_found", message: "回复不存在" } }, 404);
  if (Number(post.is_first)) return c.json({ ok: false, error: { code: "conflict", message: "首帖请通过删除主题处理" } }, 409);
  const allowed = await canDeleteContent({
    db: c.env.DB,
    user,
    config: c.get("config"),
    categoryId: post.category_id,
    authorId: post.author_id,
  });
  if (!allowed) return c.json({ ok: false, error: { code: "forbidden", message: "无权删除该回复" } }, 403);
  const now = Math.floor(Date.now() / 1000);
  const postContent = await c.env.DB.prepare("SELECT version, title, content_md FROM posts WHERE id = ?").bind(post.id).first<{ version: number; title: string | null; content_md: string }>();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO post_revisions (id, topic_id, post_id, version, title, content_md, action, editor_id, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'delete', ?, NULL, ?)`,
    ).bind(ulid(), post.topic_id, post.id, postContent?.version ?? 1, postContent?.title ?? null, postContent?.content_md ?? "", user.id, now),
    c.env.DB.prepare("UPDATE posts SET status = 'deleted', deleted_at = ?, deleted_by = ?, updated_at = ? WHERE id = ?").bind(now, user.id, now, post.id),
    c.env.DB.prepare("UPDATE topics SET reply_count = MAX(0, reply_count - 1), updated_at = ? WHERE id = ?").bind(now, post.topic_id),
    ftsDeleteStatement(c.env.DB, post.id),
    c.env.DB.prepare(
      `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, meta_json, ip_hash, created_at)
       VALUES (?, ?, 'post.delete', 'post', ?, NULL, NULL, ?)`,
    ).bind(ulid(), user.id, post.id, now),
  ]);
  return c.json({ ok: true, data: { deleted: true } });
});

forumRoutes.post("/api/posts/:id/like", requireAuth, requireActive, async (c) => {
  const user = c.get("user")!;
  const post = await c.env.DB.prepare("SELECT id, topic_id, is_first, status FROM posts WHERE id = ? AND status = 'published'")
    .bind(c.req.param("id")).first<{ id: string; topic_id: string; is_first: number }>();
  if (!post) return c.json({ ok: false, error: { code: "not_found", message: "回复不存在" } }, 404);
  const now = Math.floor(Date.now() / 1000);
  const inserted = await c.env.DB.prepare(
    "INSERT OR IGNORE INTO post_likes (user_id, post_id, created_at) VALUES (?, ?, ?)",
  ).bind(user.id, post.id, now).run();
  const liked = Number(inserted.meta.changes ?? 0) > 0;
  if (!liked) {
    await c.env.DB.prepare("DELETE FROM post_likes WHERE user_id = ? AND post_id = ?").bind(user.id, post.id).run();
  }
  const statements = [
    c.env.DB.prepare(
      "UPDATE posts SET like_count = (SELECT COUNT(*) FROM post_likes WHERE post_id = ?) WHERE id = ?",
    ).bind(post.id, post.id),
  ];
  if (Number(post.is_first)) {
    statements.push(
      c.env.DB.prepare(
        "UPDATE topics SET like_count = COALESCE((SELECT like_count FROM posts WHERE topic_id = ? AND is_first = 1), 0) WHERE id = ?",
      ).bind(post.topic_id, post.topic_id),
    );
  }
  await c.env.DB.batch(statements);
  const row = await c.env.DB.prepare("SELECT like_count FROM posts WHERE id = ?").bind(post.id).first<{ like_count: number }>();
  return c.json({ ok: true, data: { liked, likeCount: Number(row?.like_count ?? 0) } });
});


forumRoutes.post("/api/topics/:id/bookmark", requireAuth, requireActive, async (c) => {
  const user = c.get("user")!;
  const topicId = c.req.param("id");
  const topic = await c.env.DB.prepare("SELECT id FROM topics WHERE id = ? AND status = 'published'").bind(topicId).first();
  if (!topic) return c.json({ ok: false, error: { code: "not_found", message: "主题不存在" } }, 404);
  const inserted = await c.env.DB.prepare(
    "INSERT OR IGNORE INTO bookmarks (user_id, topic_id, created_at) VALUES (?, ?, ?)",
  ).bind(user.id, topicId, Math.floor(Date.now() / 1000)).run();
  const bookmarked = Number(inserted.meta.changes ?? 0) > 0;
  if (!bookmarked) {
    await c.env.DB.prepare("DELETE FROM bookmarks WHERE user_id = ? AND topic_id = ?").bind(user.id, topicId).run();
  }
  return c.json({ ok: true, data: { bookmarked } });
});

forumRoutes.post("/api/topics/:id/view", async (c) => {
  const topicId = c.req.param("id");
  const exists = await c.env.DB.prepare("SELECT 1 AS ok FROM topics WHERE id = ? AND status = 'published'").bind(topicId).first();
  if (!exists) return c.json({ ok: false, error: { code: "not_found", message: "主题不存在" } }, 404);
  const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ipHash = await hashIp(c.env, ip);
  const limit = await consumeRateLimit(c.env, `view:${topicId}:${ipHash}`, 300, 1);
  if (!limit.allowed) return c.json({ ok: true, data: { viewed: false } });
  await c.env.DB.prepare("UPDATE topics SET view_count = view_count + 1 WHERE id = ? AND status = 'published'").bind(topicId).run();
  return c.json({ ok: true, data: { viewed: true } });
});
