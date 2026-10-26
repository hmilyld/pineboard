import { BASE, assert, json, reset, saveResults } from "./lib.mjs";

const results = [];
const evidence = {};

function parseServerTiming(header) {
  const out = {};
  for (const part of (header ?? "").split(",")) {
    const [name, value] = part.trim().split(";dur=");
    if (name && value) out[name] = Number(value);
  }
  return out;
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function seedTopic(id, title, content, status) {
  if (status) {
    const response = await fetch(BASE + "/spike/fts/seed-status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status, title, content }),
    });
    return (await response.json()).data;
  }
  const response = await fetch(BASE + "/spike/fts/seed", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, title, content }),
  });
  return (await response.json()).data;
}

await reset();
const topic = await seedTopic("doc-topic-1", "文档主题标题", "这是用于文档 meta 注入的摘要内容。");
await fetch(BASE + "/spike/cache/flush?id=" + topic.topicId);

const first = await fetch(`${BASE}/t/${topic.topicId}`);
const firstHtml = await first.text();
const firstTiming = parseServerTiming(first.headers.get("server-timing"));
const firstCache = first.headers.get("x-spike-cache");

const second = await fetch(`${BASE}/t/${topic.topicId}`);
const secondHtml = await second.text();
const secondTiming = parseServerTiming(second.headers.get("server-timing"));

evidence.meta = {
  status: first.status,
  cache: firstCache,
  timing: firstTiming,
  title: firstHtml.match(/<title>(.*?)<\/title>/)?.[1],
  description: firstHtml.match(/<meta name="description" content="(.*?)"/)?.[1],
  canonical: firstHtml.match(/<link rel="canonical" href="(.*?)"/)?.[1],
  ogTitle: firstHtml.match(/<meta property="og:title" content="(.*?)"/)?.[1],
  twitterTitle: firstHtml.match(/<meta name="twitter:title" content="(.*?)"/)?.[1],
  jsonLd: firstHtml.match(/<script type="application\/ld\+json" id="spike-jsonld">(.*?)<\/script>/)?.[1],
  shellPresent: firstHtml.includes("Forum Spike Shell"),
};
assert(results, "doc: 200 renders SPA shell with injected title", first.status === 200 && evidence.meta.title === "文档主题标题" && evidence.meta.shellPresent, evidence.meta);
assert(results, "doc: description/canonical/og/twitter injected", Boolean(evidence.meta.description && evidence.meta.canonical && evidence.meta.ogTitle && evidence.meta.twitterTitle), evidence.meta);
assert(results, "doc: JSON-LD DiscussionForumPosting injected with < escaped", Boolean(evidence.meta.jsonLd?.includes("DiscussionForumPosting")), evidence.meta.jsonLd);
assert(results, "doc: first request is a cache miss", firstCache === "miss", firstCache);
assert(results, "doc: second request is a cache hit", second.headers.get("x-spike-cache") === "hit", second.headers.get("x-spike-cache"));
assert(results, "doc: cache hit skips the D1 query", secondTiming.d1 === undefined, secondTiming);

// --- Hidden / deleted / missing ---------------------------------------------------
const hidden = await seedTopic(null, "隐藏机密标题", "隐藏机密内容", "hidden");
const hiddenResponse = await fetch(`${BASE}/t/${hidden.topicId}`);
const hiddenHtml = await hiddenResponse.text();
const missing = await fetch(`${BASE}/t/does-not-exist`);
const missingHtml = await missing.text();
evidence.visibility = {
  hiddenStatus: hiddenResponse.status,
  hiddenTitle: hiddenHtml.match(/<title>(.*?)<\/title>/)?.[1],
  leaksHiddenTitle: hiddenHtml.includes("隐藏机密标题"),
  missingStatus: missing.status,
  missingTitle: missingHtml.match(/<title>(.*?)<\/title>/)?.[1],
};
assert(results, "doc: hidden topic returns 404 and does not leak its title", hiddenResponse.status === 404 && !evidence.visibility.leaksHiddenTitle, evidence.visibility);
assert(results, "doc: missing topic returns 404 with SPA shell", missing.status === 404 && missingHtml.includes("Forum Spike Shell"), evidence.visibility);

// --- Cache throughput -------------------------------------------------------------
const wall = [];
const serverTotal = [];
let hits = 0;
let misses = 0;
for (let i = 0; i < 100; i++) {
  const start = performance.now();
  const response = await fetch(`${BASE}/t/${topic.topicId}`);
  await response.text();
  wall.push(performance.now() - start);
  const timing = parseServerTiming(response.headers.get("server-timing"));
  if (timing.total !== undefined) serverTotal.push(timing.total);
  if (response.headers.get("x-spike-cache") === "hit") hits++;
  else misses++;
}
evidence.throughput = {
  requests: 100,
  hits,
  misses,
  serverTotalP50: percentile(serverTotal, 50),
  serverTotalP95: percentile(serverTotal, 95),
  clientWallP50: Number(percentile(wall, 50).toFixed(2)),
  clientWallP95: Number(percentile(wall, 95).toFixed(2)),
};
assert(results, "doc: 100 cached requests stay cache-hits", hits === 100 && misses === 0, evidence.throughput);
assert(results, "doc: cached server time P95 < 5ms (Go criterion)", evidence.throughput.serverTotalP95 < 5, evidence.throughput);

// --- Static assets bypass the Worker ---------------------------------------------
const root = await fetch(BASE + "/");
const rootHtml = await root.text();
evidence.static = { status: root.status, hasSpikeHeader: root.headers.has("x-spike-cache"), shell: rootHtml.includes("Forum Spike Shell") };
assert(results, "static: / is served from assets without Worker header", root.status === 200 && !evidence.static.hasSpikeHeader, evidence.static);

// --- CPU proxy --------------------------------------------------------------------
const cpuProbe = await (await fetch(BASE + "/spike/cpu/probe")).json();
evidence.cpu = cpuProbe.data;
assert(results, "cpu: 1000 HMAC-SHA256 operations complete locally", cpuProbe.data.operations === 1000, evidence.cpu);

const failed = results.filter((row) => !row.pass);
console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results, evidence }, null, 2));
saveResults("spike1.json", { passed: results.length - failed.length, failed: failed.length, results, evidence });
if (failed.length > 0) process.exitCode = 1;
