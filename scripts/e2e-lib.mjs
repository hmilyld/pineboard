// Shared helpers for the local e2e scripts. Every script runs from the repo
// root against `pnpm dev` and the local Miniflare D1 database.
import { readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export const DB_DIR = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";
export const TURNSTILE = "XXXX.DUMMY.TOKEN.XXXX";

export function createResults(detailLimit = 400) {
  const results = [];
  function assert(name, condition, detail) {
    results.push({ name, pass: Boolean(condition), detail });
    if (condition) console.log("PASS:", name);
    else console.log("FAIL:", name, JSON.stringify(detail ?? null).slice(0, detailLimit));
  }
  return { results, assert };
}

export function localDb() {
  const file = readdirSync(DB_DIR).find((name) => name.endsWith(".sqlite") && !name.startsWith("metadata"));
  if (!file) throw new Error("local D1 sqlite not found");
  return new DatabaseSync(`${DB_DIR}/${file}`);
}
