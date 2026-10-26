import { readFileSync } from "node:fs";

const input = process.argv[2];
if (!input) {
  console.error("usage: node scripts/check-backup-tables.mjs <d1-table-list.json>");
  process.exit(2);
}
const raw = readFileSync(input, "utf8");
const start = raw.indexOf("[");
const parsed = JSON.parse(raw.slice(start));
const remote = new Set((parsed[0]?.results ?? []).map((row) => row.name).filter(Boolean));

const backup = readFileSync(new URL("../.github/workflows/backup.yml", import.meta.url), "utf8");
const block = backup.match(/TABLES=\(\n([\s\S]*?)\n\s*\)/)?.[1] ?? "";
const listed = new Set(block.split(/\s+/).filter((name) => /^[a-z_]+$/i.test(name)));

const ignored = new Set(["post_search", "sqlite_sequence", "_cf_KV", "d1_migrations"]);
const missing = [...remote].filter((name) => !ignored.has(name) && !name.startsWith("post_search_") && !listed.has(name));
const absent = [...listed].filter((name) => !remote.has(name));
if (missing.length) {
  console.error(`backup.yml is missing tables: ${missing.join(", ")}`);
  process.exit(1);
}
if (absent.length) console.warn(`backup.yml lists tables not present remotely: ${absent.join(", ")}`);
console.log(`backup table list covers ${listed.size} configured tables`);
