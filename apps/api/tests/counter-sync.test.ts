import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COUNTER_RECONCILE_SQL } from "../src/counter-sync";

/**
 * These tests run the real SQL against a real SQLite database: the counter
 * reconciliation and the tag-count triggers are the parts of the D1 budget
 * work that silently corrupt data if a `WHERE` is wrong, and no e2e suite
 * reaches them. `node:sqlite` ships with the Node version CI pins (24).
 */
type Sqlite = typeof import("node:sqlite").DatabaseSync;

async function openDatabase(): Promise<{ DatabaseSync: Sqlite } | null> {
  try {
    return await import("node:sqlite");
  } catch {
    return null;
  }
}

const MIGRATION = new URL("../../../packages/db/migrations/0016_tag_count_triggers.sql", import.meta.url);

/** Minimal shape of the tables the triggers and the reconciliation touch. */
const SCHEMA = `
CREATE TABLE tags (id TEXT PRIMARY KEY, usage_count INTEGER NOT NULL DEFAULT 0);
CREATE TABLE topics (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  reply_count INTEGER NOT NULL DEFAULT 0,
  like_count INTEGER NOT NULL DEFAULT 0,
  last_post_at INTEGER NOT NULL DEFAULT 0,
  last_post_user_id TEXT
);
CREATE TABLE posts (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  is_first INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  like_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE post_likes (post_id TEXT NOT NULL);
CREATE TABLE topic_tags (topic_id TEXT NOT NULL, tag_id TEXT NOT NULL);
`;

function applyMigration(db: InstanceType<Sqlite>) {
  const sql = readFileSync(MIGRATION, "utf8").replaceAll("--> statement-breakpoint", "");
  db.exec(sql);
}

describe("tag counts stay exact without the daily job", () => {
  it("tracks topic status transitions and tag links", async () => {
    const sqlite = await openDatabase();
    if (!sqlite) throw new Error("node:sqlite is required for this test");
    const db = new sqlite.DatabaseSync(":memory:");
    db.exec(SCHEMA);
    applyMigration(db);
    const usage = () =>
      (db.prepare("SELECT usage_count FROM tags WHERE id = 't1'").get() as { usage_count: number }).usage_count;

    db.prepare("INSERT INTO tags (id, usage_count) VALUES ('t1', 0)").run();
    db.prepare("INSERT INTO topics (id, status) VALUES ('p1', 'published')").run();
    db.prepare("INSERT INTO topic_tags (topic_id, tag_id) VALUES ('p1', 't1')").run();
    expect(usage()).toBe(1);

    db.prepare("UPDATE topics SET status = 'deleted' WHERE id = 'p1'").run();
    expect(usage()).toBe(0);

    db.prepare("UPDATE topics SET status = 'published' WHERE id = 'p1'").run();
    expect(usage()).toBe(1);

    // A pending topic is not counted, and approving it must count.
    db.prepare("UPDATE topics SET status = 'pending' WHERE id = 'p1'").run();
    expect(usage()).toBe(0);
    db.prepare("UPDATE topics SET status = 'published' WHERE id = 'p1'").run();
    expect(usage()).toBe(1);

    db.prepare("DELETE FROM topic_tags WHERE topic_id = 'p1'").run();
    expect(usage()).toBe(0);
  });
});

describe("daily counter reconciliation", () => {
  it("repairs drift and is a no-op once clean", async () => {
    const sqlite = await openDatabase();
    if (!sqlite) throw new Error("node:sqlite is required for this test");
    const db = new sqlite.DatabaseSync(":memory:");
    db.exec(SCHEMA);

    db.prepare("INSERT INTO tags (id, usage_count) VALUES ('t1', 0)").run();
    db.prepare(
      "INSERT INTO topics (id, status, reply_count, like_count, last_post_at) VALUES ('p1', 'published', 0, 0, 0)",
    ).run();
    db.prepare(
      "INSERT INTO posts (id, topic_id, author_id, is_first, status, like_count, created_at) VALUES ('a', 'p1', 'u1', 1, 'published', 0, 100)",
    ).run();
    db.prepare(
      "INSERT INTO posts (id, topic_id, author_id, is_first, status, like_count, created_at) VALUES ('b', 'p1', 'u2', 0, 'published', 0, 200)",
    ).run();
    db.prepare("INSERT INTO post_likes (post_id) VALUES ('b')").run();
    db.prepare("INSERT INTO topic_tags (topic_id, tag_id) VALUES ('p1', 't1')").run();

    // Pretend the write paths lost their updates.
    db.exec("UPDATE topics SET reply_count = 9, like_count = 9, last_post_at = 0, last_post_user_id = NULL");
    db.exec("UPDATE posts SET like_count = 9");

    const reconcile = () => {
      let changed = 0;
      for (const sql of COUNTER_RECONCILE_SQL) changed += Number(db.prepare(sql).run().changes ?? 0);
      return changed;
    };

    expect(reconcile()).toBeGreaterThan(0);

    const topic = db
      .prepare("SELECT reply_count, like_count, last_post_at, last_post_user_id FROM topics WHERE id = 'p1'")
      .get();
    expect(topic).toMatchObject({ reply_count: 1, like_count: 0, last_post_at: 200, last_post_user_id: "u2" });
    expect((db.prepare("SELECT like_count FROM posts WHERE id = 'b'").get() as { like_count: number }).like_count).toBe(
      1,
    );
    expect(
      (db.prepare("SELECT usage_count FROM tags WHERE id = 't1'").get() as { usage_count: number }).usage_count,
    ).toBe(1);

    // Second pass must write nothing: that is what keeps the daily job off the
    // write quota as the forum grows.
    expect(reconcile()).toBe(0);
  });
});
