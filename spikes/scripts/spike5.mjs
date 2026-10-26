// Spike 5 (local half): migration replay, D1 export/restore into a fresh
// database, and a Wrangler deploy dry-run. The remote half (wrangler d1
// migrations apply --remote, wrangler rollback, GitHub Actions execution)
// requires Cloudflare credentials and is deliberately not faked here.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { resolve } from "node:path";

const root = process.cwd();
const env = {
  ...process.env,
  XDG_CONFIG_HOME: resolve(".config"),
  WRANGLER_LOG_PATH: resolve(".wrangler/logs"),
};
const tmp = resolve(".wrangler/spike5");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

function wrangler(args) {
  return execFileSync("pnpm", ["exec", "wrangler", ...args], {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function sqlJson(persistTo, command) {
  const output = wrangler(["d1", "execute", "DB", "--local", "--persist-to", persistTo, "--command", command, "--json"]);
  const match = output.match(/(\[\s*\{[\s\S]*\}\s*\])/);
  if (!match) throw new Error(`no JSON in output: ${output.slice(-300)}`);
  return JSON.parse(match[1])[0]?.results ?? [];
}

const evidence = { steps: [] };
function step(name, fn) {
  try {
    const detail = fn();
    evidence.steps.push({ name, pass: true, detail });
    return detail;
  } catch (error) {
    evidence.steps.push({ name, pass: false, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

const source = resolve(tmp, "source");
const restored = resolve(tmp, "restored");

step("migrate fresh local D1", () => {
  const output = wrangler(["d1", "migrations", "apply", "DB", "--local", "--persist-to", source]);
  return { applied: /0001_init\.sql/.test(output) && /0003_fts_probe_verify\.sql/.test(output) };
});

step("seed data (normal + FTS rows)", () => {
  const now = Math.floor(Date.now() / 1000);
  wrangler([
    "d1",
    "execute",
    "DB",
    "--local",
    "--persist-to",
    source,
    "--command",
    `INSERT INTO categories (id, slug, name, created_at) VALUES ('backup-cat','backup-cat','Backup',${now});
     INSERT INTO topics (id, category_id, author_id, first_post_id, status, last_post_at, created_at, updated_at)
       VALUES ('backup-topic','backup-cat','u1','backup-post','published',${now},${now},${now});
     INSERT INTO posts (id, topic_id, author_id, floor, is_first, title, content_md, content_text, status, created_at, updated_at)
       VALUES ('backup-post','backup-topic','u1',1,1,'备份主题','备份正文','备份正文','published',${now},${now});
     INSERT INTO post_search (post_uid, topic_id, title, tokens) VALUES ('backup-post','backup-topic','备份主题','备份 份主 主题');`,
  ]);
  return sqlJson(source, "SELECT (SELECT COUNT(*) FROM topics) AS topics, (SELECT COUNT(*) FROM post_search) AS fts, (SELECT COUNT(*) FROM d1_migrations) AS migrations;")[0];
});

let backup = null;
let fullExportError = null;
// `wrangler d1 export` has no --persist-to; it always reads
// <cwd>/.wrangler/state. Copy the isolated state into that layout.
const exportCwd = resolve(tmp, "export-cwd");
mkdirSync(resolve(exportCwd, ".wrangler"), { recursive: true });
cpSync(source, resolve(exportCwd, ".wrangler/state"), { recursive: true });
const exportConfig = resolve(exportCwd, "wrangler.jsonc");
writeFileSync(
  exportConfig,
  JSON.stringify(
    {
      name: "spike-export",
      main: resolve("src/index.ts"),
      compatibility_date: "2026-10-01",
      d1_databases: [
        {
          binding: "DB",
          database_name: "forum-spike",
          database_id: "00000000-0000-4000-8000-000000000000",
          migrations_dir: resolve("migrations"),
        },
      ],
    },
    null,
    2,
  ),
);
const exportArgs = (output, extra = []) => [
  "d1",
  "export",
  "forum-spike",
  "--local",
  "-c",
  exportConfig,
  "--cwd",
  exportCwd,
  "--output",
  output,
  ...extra,
];
step("full export is blocked by FTS5 virtual table (observed)", () => {
  try {
    wrangler(exportArgs(resolve(tmp, "full.sql")));
    return { blocked: false };
  } catch (error) {
    const message = String(error.stderr ?? error.message ?? error);
    fullExportError = message.match(/cannot export databases with Virtual Tables[^\n]*/)?.[0] ?? message.slice(-300);
    return { blocked: true, error: fullExportError };
  }
});

const EXPORT_TABLES = [
  "user",
  "session",
  "account",
  "verification",
  "rateLimit",
  "categories",
  "topics",
  "posts",
  "post_revisions",
  "spike_outbox",
];

step("data-only export excluding post_search", () => {
  const output = resolve(tmp, "backup.sql");
  const extra = ["--no-schema"];
  for (const table of EXPORT_TABLES) extra.push("--table", table);
  wrangler(exportArgs(output, extra));
  const bytes = readFileSync(output);
  const gz = gzipSync(bytes);
  const gzPath = output + ".gz";
  writeFileSync(gzPath, gz);
  backup = {
    tables: EXPORT_TABLES,
    sqlBytes: bytes.byteLength,
    gzBytes: gz.byteLength,
    sha256: createHash("sha256").update(gz).digest("hex"),
    hasFtsData: bytes.toString("utf8").includes("post_search"),
    path: output,
    gzPath,
  };
  return backup;
});

step("restore: migrations + data-only import into a fresh D1", () => {
  wrangler(["d1", "migrations", "apply", "DB", "--local", "--persist-to", restored]);
  wrangler(["d1", "execute", "DB", "--local", "--persist-to", restored, "--file", backup.path]);
  return sqlJson(restored, "SELECT (SELECT COUNT(*) FROM topics) AS topics, (SELECT COUNT(*) FROM post_search) AS fts;")[0];
});

step("compare source and restored row counts", () => {
  const a = sqlJson(source, "SELECT (SELECT COUNT(*) FROM topics) AS topics, (SELECT COUNT(*) FROM posts) AS posts;")[0];
  const b = sqlJson(restored, "SELECT (SELECT COUNT(*) FROM topics) AS topics, (SELECT COUNT(*) FROM posts) AS posts;")[0];
  if (a.topics !== b.topics || a.posts !== b.posts) throw new Error(`mismatch ${JSON.stringify({ a, b })}`);
  return { source: a, restored: b, ftsMustBeRebuilt: true };
});

step("wrangler deploy dry-run", () => {
  const outdir = resolve(tmp, "dist");
  const output = wrangler(["deploy", "--dry-run", "--outdir", outdir]);
  return {
    hasBundledWorker: /Total Upload|Your worker has access|Dry run/i.test(output),
    outdir,
  };
});

// The backup SQL must not contain secrets or environment values.
step("backup excludes .dev.vars/secrets", () => {
  const sql = readFileSync(backup.path, "utf8");
  const leaks = ["BETTER_AUTH_SECRET", "PASSWORD_PEPPER", "R2_SECRET_ACCESS_KEY", "spike-secret-key"].filter((needle) => sql.includes(needle));
  if (leaks.length) throw new Error(`leaked: ${leaks.join(",")}`);
  return { leaks: [] };
});

const failed = evidence.steps.filter((row) => !row.pass);
evidence.backup = backup;
evidence.fullExportError = fullExportError;
evidence.ftsRebuildRequired = "post_search is derived data: full d1 export rejects virtual tables, so backups exclude it and restore must run the search reindex endpoint/script.";
evidence.remoteBlocked = {
  remoteMigrations: "requires CLOUDFLARE_API_TOKEN + real database_id",
  remoteExport: "requires CLOUDFLARE_API_TOKEN",
  wranglerRollback: "requires deployed Worker versions and API token",
  githubActionsExecution: "repository has no remote; workflows linted with actionlint 1.7.7",
};
evidence.pass = failed.length === 0;
console.log(JSON.stringify(evidence, null, 2));
mkdirSync("results", { recursive: true });
writeFileSync("results/spike5.json", JSON.stringify(evidence, null, 2) + "\n");
if (failed.length) process.exitCode = 1;
