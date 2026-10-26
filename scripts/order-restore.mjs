import { readFileSync, writeFileSync } from "node:fs";

const ORDER = [
  "user", "account", "session", "verification", "settings",
  "categories", "category_moderators", "tags",
  "topics", "posts", "post_revisions", "topic_tags", "post_likes", "bookmarks",
  "reports", "notifications", "notification_preferences",
  "email_unsubscribe_tokens", "email_logs", "email_suppressions",
  "audit_logs", "rateLimit", "rate_limits",
];

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error("usage: node scripts/order-restore.mjs <export.sql> <ordered.sql>");
  process.exit(64);
}

const lines = readFileSync(inputPath, "utf8").split(/\r?\n/);
const groups = new Map();
const header = [];
for (const line of lines) {
  const match = line.match(/^INSERT INTO "([^"]+)"/);
  if (!match) {
    if (line && !line.startsWith("INSERT")) header.push(line);
    continue;
  }
  if (!groups.has(match[1])) groups.set(match[1], []);
  groups.get(match[1]).push(line);
}

const ordered = [];
for (const table of ORDER) {
  if (groups.has(table)) {
    ordered.push(...groups.get(table));
    groups.delete(table);
  }
}
for (const rest of groups.values()) ordered.push(...rest);
writeFileSync(outputPath, `${header.join("\n")}\n${ordered.join("\n")}\n`);
console.log(JSON.stringify({ input: inputPath, output: outputPath, lines: ordered.length }));
