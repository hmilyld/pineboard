/**
 * Drift-only counter reconciliation, run by the daily maintenance job.
 *
 * Every statement is scoped to rows whose stored value disagrees with the
 * aggregate. A full-table `UPDATE` would rewrite every row once a day, and the
 * write is what the D1 free tier caps — at ~100k posts that single pass could
 * consume the whole daily budget on its own.
 *
 * Kept as SQL text so the reconciliation can be exercised against a real
 * SQLite database in `counter-sync.test.ts`.
 */
export const COUNTER_RECONCILE_SQL: readonly string[] = [
  `UPDATE posts SET like_count = agg.n
     FROM (SELECT post_id, COUNT(*) AS n FROM post_likes GROUP BY post_id) agg
    WHERE posts.id = agg.post_id AND posts.like_count != agg.n`,
  `UPDATE posts SET like_count = 0
    WHERE like_count != 0
      AND NOT EXISTS (SELECT 1 FROM post_likes pl WHERE pl.post_id = posts.id)`,
  `UPDATE topics SET reply_count = agg.n
     FROM (SELECT topic_id, COUNT(*) AS n FROM posts
            WHERE is_first = 0 AND status = 'published' GROUP BY topic_id) agg
    WHERE topics.id = agg.topic_id AND topics.reply_count != agg.n`,
  `UPDATE topics SET reply_count = 0
    WHERE reply_count != 0
      AND NOT EXISTS (
        SELECT 1 FROM posts p
         WHERE p.topic_id = topics.id AND p.is_first = 0 AND p.status = 'published')`,
  `UPDATE topics SET like_count = fp.like_count
     FROM (SELECT topic_id, like_count FROM posts WHERE is_first = 1) fp
    WHERE topics.id = fp.topic_id AND topics.like_count != fp.like_count`,
  `UPDATE topics SET like_count = 0
    WHERE like_count != 0
      AND NOT EXISTS (SELECT 1 FROM posts fp WHERE fp.topic_id = topics.id AND fp.is_first = 1)`,
  `UPDATE tags SET usage_count = agg.n
     FROM (SELECT tt.tag_id, COUNT(*) AS n FROM topic_tags tt JOIN topics t ON t.id = tt.topic_id
            WHERE t.status = 'published' GROUP BY tt.tag_id) agg
    WHERE tags.id = agg.tag_id AND tags.usage_count != agg.n`,
  `UPDATE tags SET usage_count = 0
    WHERE usage_count != 0
      AND NOT EXISTS (
        SELECT 1 FROM topic_tags tt JOIN topics t ON t.id = tt.topic_id
         WHERE tt.tag_id = tags.id AND t.status = 'published')`,
  // Only topics whose stored tail disagrees with the newest published post.
  `UPDATE topics SET
     last_post_at = COALESCE((SELECT MAX(p.created_at) FROM posts p
                               WHERE p.topic_id = topics.id AND p.status = 'published'), last_post_at),
     last_post_user_id = COALESCE((SELECT p.author_id FROM posts p
                                    WHERE p.topic_id = topics.id AND p.status = 'published'
                                    ORDER BY p.created_at DESC LIMIT 1), last_post_user_id)
    WHERE last_post_at != COALESCE((SELECT MAX(p.created_at) FROM posts p
                                     WHERE p.topic_id = topics.id AND p.status = 'published'), last_post_at)
       OR last_post_user_id IS NOT COALESCE((SELECT p.author_id FROM posts p
                                              WHERE p.topic_id = topics.id AND p.status = 'published'
                                              ORDER BY p.created_at DESC LIMIT 1), last_post_user_id)`,
];
