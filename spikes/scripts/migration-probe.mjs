// Proves that D1 migrations can both CREATE and WRITE an FTS5 table. Runs
// against an isolated local persistence directory so it never touches dev data
// and never fights the running `wrangler dev` for the D1 file lock.
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";

const persistTo = resolve(".wrangler/migration-probe");
rmSync(persistTo, { recursive: true, force: true });

const env = {
  ...process.env,
  XDG_CONFIG_HOME: resolve(".config"),
  WRANGLER_LOG_PATH: resolve(".wrangler/logs"),
};

function wrangler(args) {
  return execFileSync("pnpm", ["exec", "wrangler", ...args], {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const applyOutput = wrangler(["d1", "migrations", "apply", "DB", "--local", "--persist-to", persistTo]);
const queryOutput = wrangler([
  "d1",
  "execute",
  "DB",
  "--local",
  "--persist-to",
  persistTo,
  "--command",
  "SELECT post_uid, title, tokens FROM post_search WHERE post_uid = 'migration-probe-2';",
  "--json",
]);
const match = queryOutput.match(/(\[\s*\{[\s\S]*\}\s*\])/);
if (!match) throw new Error(`no JSON in wrangler output: ${queryOutput.slice(-400)}`);
const parsed = JSON.parse(match[1]);
const rows = parsed[0]?.results ?? [];
const result = {
  applied: /0003_fts_probe_verify\.sql/.test(applyOutput),
  ftsRow: rows[0] ?? null,
  pass: rows.length === 1,
};
console.log(JSON.stringify(result, null, 2));
if (!result.pass) process.exitCode = 1;
