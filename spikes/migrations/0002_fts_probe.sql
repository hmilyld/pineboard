-- Spike-only: prove that a D1 migration can write into an FTS5 virtual table,
-- not just create it. Production migrations must never seed content.
INSERT INTO post_search (post_uid, topic_id, title, tokens)
VALUES ('migration-probe', 'migration-topic', '迁移写入', '迁移 移写 写入');
