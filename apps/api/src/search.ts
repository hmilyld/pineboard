import {
  bigramTokens,
  ftsPhrase,
  likePattern,
  needsLikeFallback,
  ok,
  type SearchResult,
  type SearchResponse,
  searchSortSchema,
} from "@pineboard/shared";
import { Hono } from "hono";
import { getSecurityConfig } from "./config";
import type { AppEnv } from "./env";
import { reindexAllPosts, auditSearchReindexStatement } from "./search-index";
import { requireAdmin } from "./middleware/guards";
import { consumeRateLimit, hashIp } from "./security";
import { markMaintenanceRun } from "./jobs";

type Row = Record<string, unknown>;

function mapResult(row: Row): SearchResult {
  return {
    postId: String(row.post_id),
    topicId: String(row.topic_id),
    topicTitle: String(row.topic_title ?? ""),
    floor: Number(row.floor),
    snippet: String(row.content_text ?? "").slice(0, 220),
    author: {
      id: String(row.author_id),
      username: (row.author_username as string | null) ?? null,
      name: String(row.author_name),
      avatarKey: (row.author_avatar_key as string | null) ?? null,
    },
    category: { id: String(row.category_id), slug: String(row.category_slug), name: String(row.category_name), color: String(row.category_color ?? "#14513f") },
    createdAt: Number(row.created_at),
  };
}

export const searchRoutes = new Hono<AppEnv>();

searchRoutes.get("/api/search", async (c) => {
  const loaded = await getSecurityConfig(c.env);
  if (!loaded.config.feature.search) return c.json({ ok: false, error: { code: "not_found", message: "搜索未开启" } }, 404);
  const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const limit = await consumeRateLimit(c.env, `search:${await hashIp(c.env, ip)}`, 60, 60);
  if (!limit.allowed) return c.json({ ok: false, error: { code: "rate_limited", message: "搜索过于频繁，请稍后再试" } }, 429);
  const q = (c.req.query("q") ?? "").trim().slice(0, 100);
  const sortParsed = searchSortSchema.safeParse(c.req.query("sort") ?? "relevance");
  if (!sortParsed.success) return c.json({ ok: false, error: { code: "validation_error", message: "排序参数不合法" } }, 400);
  const sort = sortParsed.data;
  const pageRaw = Number(c.req.query("page") ?? 1);
  const perPageRaw = Number(c.req.query("perPage") ?? 20);
  const page = Number.isFinite(pageRaw) ? Math.min(10_000, Math.max(1, Math.floor(pageRaw))) : 1;
  const perPage = Number.isFinite(perPageRaw) ? Math.min(50, Math.max(5, Math.floor(perPageRaw))) : 20;
  if (!q) {
    const empty: SearchResponse = { q, mode: "fts", sort, items: [], page, perPage, total: 0 };
    return c.json(ok(empty));
  }
  const tokens = bigramTokens(q);
  const mode = !tokens || needsLikeFallback(q) ? "like" : "fts";
  let rows: D1Result<Row>;
  let countRow: { total?: number } | null;
  const joins = `FROM posts p JOIN topics t ON t.id = p.topic_id JOIN categories c ON c.id = t.category_id JOIN user u ON u.id = p.author_id`;
  const baseWhere = "p.status = 'published' AND t.status = 'published' AND c.is_visible = 1";
  if (mode === "like") {
    const pattern = likePattern(q);
    countRow = await c.env.DB.prepare(
      `SELECT COUNT(*) AS total ${joins} WHERE ${baseWhere} AND (p.title LIKE ? ESCAPE '\\' OR p.content_text LIKE ? ESCAPE '\\')`,
    ).bind(pattern, pattern).first();
    rows = await c.env.DB.prepare(
      `SELECT p.id AS post_id, p.topic_id, p.floor, p.content_text, p.created_at,
              (SELECT fp.title FROM posts fp WHERE fp.topic_id = t.id AND fp.is_first = 1 LIMIT 1) AS topic_title,
              u.id AS author_id, u.username AS author_username, u.name AS author_name, u.avatar_key AS author_avatar_key,
              c.id AS category_id, c.slug AS category_slug, c.name AS category_name, c.color AS category_color
         ${joins}
        WHERE ${baseWhere} AND (p.title LIKE ? ESCAPE '\\' OR p.content_text LIKE ? ESCAPE '\\')
        ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
    ).bind(pattern, pattern, perPage, (page - 1) * perPage).all<Row>();
  } else {
    const phrase = ftsPhrase(tokens);
    countRow = await c.env.DB.prepare(
      `SELECT COUNT(*) AS total ${joins} JOIN post_search ON post_search.post_uid = p.id
        WHERE post_search MATCH ? AND ${baseWhere}`,
    ).bind(phrase).first();
    rows = await c.env.DB.prepare(
      `SELECT p.id AS post_id, p.topic_id, p.floor, p.content_text, p.created_at,
              (SELECT fp.title FROM posts fp WHERE fp.topic_id = t.id AND fp.is_first = 1 LIMIT 1) AS topic_title,
              u.id AS author_id, u.username AS author_username, u.name AS author_name, u.avatar_key AS author_avatar_key,
              c.id AS category_id, c.slug AS category_slug, c.name AS category_name, c.color AS category_color,
              bm25(post_search) AS rank
         ${joins} JOIN post_search ON post_search.post_uid = p.id
        WHERE post_search MATCH ? AND ${baseWhere}
        ORDER BY ${sort === "latest" ? "p.created_at DESC" : "rank, p.created_at DESC"} LIMIT ? OFFSET ?`,
    ).bind(phrase, perPage, (page - 1) * perPage).all<Row>();
  }
  const data: SearchResponse = {
    q,
    mode,
    sort,
    items: rows.results.map(mapResult),
    page,
    perPage,
    total: Number(countRow?.total ?? 0),
  };
  c.header("cache-control", "public, s-maxage=30");
  return c.json(ok(data));
});

searchRoutes.post("/api/admin/search/reindex", requireAdmin, async (c) => {
  const user = c.get("user")!;
  const result = await reindexAllPosts(c.env);
  await auditSearchReindexStatement(c.env.DB, user.id, result).run();
  await markMaintenanceRun(c.env, "reindex");
  return c.json(ok(result));
});
