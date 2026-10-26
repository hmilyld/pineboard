-- Spike-only duplicate probe; verifies a migration INSERT into FTS5 is visible.
INSERT INTO post_search (post_uid, topic_id, title, tokens)
VALUES ('migration-probe-2', 'migration-topic', '迁移二次写入', '迁移 移二 二次 次写 写入');
