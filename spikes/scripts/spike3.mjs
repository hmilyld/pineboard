import { BASE, assert, json, reset, saveResults, trace } from "./lib.mjs";

const results = [];
const evidence = {};

async function post(path, body) {
  const response = await fetch(BASE + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return json(response);
}

async function search(q) {
  const response = await fetch(BASE + "/spike/fts/search?q=" + encodeURIComponent(q));
  return json(response);
}

// --- Migration-time FTS write (checked before reset wipes it) --------------------
const rawBefore = await (await fetch(BASE + "/spike/fts/raw")).json();
evidence.migrationFtsWrite = rawBefore.data.rows.find((row) => row.post_uid === "migration-probe-2") ?? null;
// The authoritative migration check runs in scripts/migration-probe.mjs against
// an isolated D1 state; this dev database may have been reset by spike2.

// --- Seed and search --------------------------------------------------------------
await reset();
const seed = await post("/spike/fts/seed", {
  title: "游戏攻略分享",
  content: "Elden Ring 攻略：先击败接肢贵族，再前往魔法学院。",
});
const cases = {};
for (const q of ["游戏攻略", "游戏", "戏攻", "攻略", "魔法学院", "Elden Ring 攻略", "Elden"]) {
  const result = await search(q);
  cases[q] = { mode: result.data.mode, rows: result.data.rows.length, tokens: result.data.tokens, phrase: result.data.phrase, meta: result.data.meta };
}
const single = await search("攻");
const injection = await search('" OR "');
evidence.search = { cases, single: { mode: single.data.mode, rows: single.data.rows.length }, injection: { mode: injection.data.mode, rows: injection.data.rows.length } };
assert(results, "fts: 2-char Chinese hits", cases["游戏"].rows === 1, cases["游戏"]);
assert(results, "fts: bigram phrase hits", cases["游戏攻略"].rows === 1, cases["游戏攻略"]);
assert(results, "fts: mixed English + Chinese phrase hits", cases["Elden Ring 攻略"].rows === 1, cases["Elden Ring 攻略"]);
assert(results, "fts: single CJK char falls back to LIKE", single.data.mode === "like" && single.data.rows.length === 1, evidence.search.single);
assert(results, "fts: MATCH injection is escaped and returns safely", injection.ok !== false, evidence.search.injection);

// --- Hidden/deleted content must not leak ----------------------------------------
const hidden = await post("/spike/fts/seed-status", { status: "hidden", title: "隐藏机密主题", content: "隐藏机密内容" });
const hiddenSearch = await search("隐藏机密");
evidence.hiddenFilter = { hidden, hiddenRows: hiddenSearch.data.rows.length };
assert(results, "fts: hidden topic filtered out by join", hiddenSearch.data.rows.length === 0, evidence.hiddenFilter);

// --- Batch edit + CAS -------------------------------------------------------------
const editBody = {
  postId: seed.data.postId,
  expectedVersion: 1,
  title: "新标题：只狼攻略",
  content: "更新后的内容：只狼攻略与苇名一心。",
};
const edit = await post("/spike/fts/edit", editBody);
const stale = await post("/spike/fts/edit", { ...editBody, title: "stale", content: "stale" });
const afterEdit = {
  newQuery: await search("只狼"),
  oldQuery: await search("Elden"),
  staleQuery: await search("stale"),
};
evidence.batchEdit = {
  edit,
  stale,
  afterEdit: {
    newRows: afterEdit.newQuery.data.rows.length,
    oldRows: afterEdit.oldQuery.data.rows.length,
    staleRows: afterEdit.staleQuery.data.rows.length,
  },
};
assert(results, "batch edit: CAS update succeeds", edit.data.changes === 1 && edit.data.versionConflict === false, edit);
assert(results, "batch edit: stale version returns 0 changes (409 signal)", stale.data.changes === 0 && stale.data.versionConflict === true, stale);
assert(results, "batch edit: new FTS content searchable", afterEdit.newQuery.data.rows.length === 1, evidence.batchEdit.afterEdit);
assert(results, "batch edit: old FTS content removed", afterEdit.oldQuery.data.rows.length === 0, evidence.batchEdit.afterEdit);
assert(results, "batch edit: stale edit did not touch FTS", afterEdit.staleQuery.data.rows.length === 0, evidence.batchEdit.afterEdit);

// --- Batch atomicity --------------------------------------------------------------
const atomic = await post("/spike/fts/batch-atomic", {});
evidence.batchAtomic = atomic.data;
assert(results, "batch: failed batch rolls back earlier statements", atomic.data.failed && atomic.data.atomic, atomic.data);

// --- Floor allocation -------------------------------------------------------------
const sequential = [];
for (let i = 0; i < 5; i++) sequential.push(await post("/spike/fts/floor", { topicId: seed.data.topicId, content: `seq ${i}` }));
const concurrent = await Promise.all(
  Array.from({ length: 10 }, (_, i) => post("/spike/fts/floor", { topicId: seed.data.topicId, content: `race ${i}` })),
);
evidence.floor = {
  sequential: sequential.map((row) => row.data.floor),
  concurrent: concurrent.map((row) => (row.ok ? row.data.floor : row.error.code)),
};
assert(results, "floor: sequential allocation is unique", new Set(evidence.floor.sequential).size === sequential.length, evidence.floor.sequential);
assert(results, "floor: 10 concurrent allocations are unique", new Set(evidence.floor.concurrent).size === 10, evidence.floor.concurrent);

// --- Concurrent CAS ---------------------------------------------------------------
const race = await Promise.all([
  post("/spike/fts/edit", { postId: seed.data.postId, expectedVersion: 2, title: "race-a", content: "race a" }),
  post("/spike/fts/edit", { postId: seed.data.postId, expectedVersion: 2, title: "race-b", content: "race b" }),
]);
const winners = race.filter((row) => row.data?.changes === 1).length;
const losers = race.filter((row) => row.data?.versionConflict === true).length;
evidence.concurrentCas = { race, winners, losers };
assert(results, "concurrent CAS: exactly one writer wins", winners === 1 && losers === 1, evidence.concurrentCas);

// --- D1 read cost for one search --------------------------------------------------
const cost = await search("只狼");
evidence.searchCost = cost.data.meta;
assert(results, "fts: search returns D1 meta for quota accounting", cost.data.meta !== undefined, cost.data.meta);

const failed = results.filter((row) => !row.pass);
console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results, evidence }, null, 2));
saveResults("spike3.json", { passed: results.length - failed.length, failed: failed.length, results, evidence });
if (failed.length > 0) process.exitCode = 1;
