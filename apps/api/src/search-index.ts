import { bigramTokens, ulid } from "@pineboard/shared";
import type { Bindings } from "./env";

export function ftsInsertStatement(
  db: D1Database,
  input: { postId: string; topicId: string; title: string; content: string },
): D1PreparedStatement {
  return db
    .prepare("INSERT INTO post_search (post_uid, topic_id, title, tokens) VALUES (?, ?, ?, ?)")
    .bind(input.postId, input.topicId, input.title, bigramTokens(`${input.title} ${input.content}`));
}

export function ftsDeleteStatement(db: D1Database, postId: string): D1PreparedStatement {
  return db.prepare("DELETE FROM post_search WHERE post_uid = ?").bind(postId);
}

export function ftsDeleteTopicStatement(db: D1Database, topicId: string): D1PreparedStatement {
  return db.prepare("DELETE FROM post_search WHERE topic_id = ?").bind(topicId);
}

/** Rebuild the derived index from posts. Returns the number of indexed rows. */
export async function reindexAllPosts(env: Bindings): Promise<{ posts: number; batches: number }> {
  await env.DB.prepare("DELETE FROM post_search").run();
  let offset = 0;
  let posts = 0;
  let batches = 0;
  const chunk = 100;
  for (;;) {
    const rows = await env.DB.prepare(
      `SELECT p.id, p.topic_id, p.is_first, p.content_md, fp.title AS first_title
         FROM posts p JOIN topics t ON t.id = p.topic_id
         JOIN posts fp ON fp.topic_id = t.id AND fp.is_first = 1
        WHERE p.status = 'published' AND t.status = 'published'
        ORDER BY p.created_at, p.id LIMIT ? OFFSET ?`,
    ).bind(chunk, offset).all<{ id: string; topic_id: string; is_first: number; content_md: string; first_title: string }>();
    if (!rows.results.length) break;
    const statements = rows.results.map((row) =>
      ftsInsertStatement(env.DB, {
        postId: row.id,
        topicId: row.topic_id,
        title: Number(row.is_first) === 1 ? String(row.first_title ?? "") : "",
        content: String(row.content_md ?? ""),
      }),
    );
    await env.DB.batch(statements);
    posts += rows.results.length;
    batches++;
    offset += chunk;
  }
  return { posts, batches };
}

export function auditSearchReindexStatement(
  db: D1Database,
  actorId: string,
  result: { posts: number; batches: number },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, meta_json, ip_hash, created_at)
       VALUES (?, ?, 'search.reindex', 'search', NULL, ?, NULL, ?)`,
    )
    .bind(ulid(), actorId, JSON.stringify(result), Math.floor(Date.now() / 1000));
}
