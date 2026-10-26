// Local CPU profiling through the workerd inspector. This is a sampling proxy,
// not Cloudflare's billable CPU metric; it is used to catch obvious CPU blowups
// when no Cloudflare API token is available.
import { connectInspector } from "./ws-client.mjs";

const WS_URL = process.env.CDP_URL ?? "ws://127.0.0.1:9229/ws";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const ws = connectInspector(WS_URL);
  await new Promise((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
  });
  let nextId = 0;
  const pending = new Map();
  ws.on("message", (data) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send("Profiler.enable");
  const results = [];
  const cases = [
    { name: "doc-miss", url: "http://127.0.0.1:8787/t/cpu-miss", prep: "flush" },
    { name: "doc-hit", url: "http://127.0.0.1:8787/t/cpu-hit", prep: "seed" },
    { name: "auth-signin", url: "http://127.0.0.1:8787/api/auth/sign-in/email", prep: "auth" },
  ];

  for (const item of cases) {
    if (item.prep === "flush") {
      const base = "http://127.0.0.1:8787";
      const seed = await (
        await fetch(base + "/spike/fts/seed", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: "cpu-miss", title: "CPU miss", content: "CPU probe miss" }),
        })
      ).json();
      await fetch(base + "/spike/cache/flush?id=cpu-miss");
    } else if (item.prep === "seed") {
      const base = "http://127.0.0.1:8787";
      await fetch(base + "/spike/fts/seed", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "cpu-hit", title: "CPU hit", content: "CPU probe hit" }),
      });
      await fetch(base + "/t/cpu-hit");
    }

    const samples = [];
    for (let i = 0; i < 5; i++) {
      await sleep(50);
      await send("Profiler.start");
      const start = performance.now();
      let response;
      if (item.name === "auth-signin") {
        response = await fetch(item.url, {
          method: "POST",
          headers: { "content-type": "application/json", origin: "http://localhost:8787" },
          body: JSON.stringify({ email: "cpu@example.test", password: "v1$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" }),
        });
      } else {
        response = await fetch(item.url);
      }
      const wallMs = performance.now() - start;
      await response.arrayBuffer();
      await sleep(30);
      const { profile } = await send("Profiler.stop");
      samples.push(analyze(profile, wallMs, response.status));
    }
    results.push({ name: item.name, samples, median: median(samples) });
  }

  console.log(JSON.stringify(results, null, 2));
  ws.close();
}

function analyze(profile, wallMs, status) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const byKey = new Map();
  let nonIdleUs = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    const node = nodes.get(profile.samples[i]);
    const delta = profile.timeDeltas[i] ?? 0;
    const frame = node?.callFrame;
    const name = frame?.functionName || "(anonymous)";
    const url = frame?.url || "";
    if (name === "(idle)" || name === "(program)" || name === "(root)") continue;
    nonIdleUs += delta;
    if (!url.includes("/src/") && !url.includes("forum.example.com/spikes")) continue;
    const key = `${name} @ ${url.split("/").slice(-1)[0]}:${frame.lineNumber + 1}`;
    byKey.set(key, (byKey.get(key) ?? 0) + delta);
  }
  const top = [...byKey.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  return {
    status,
    wallMs: Number(wallMs.toFixed(3)),
    nonIdleCpuMs: Number((nonIdleUs / 1000).toFixed(3)),
    top: top.map(([key, us]) => ({ key, ms: Number((us / 1000).toFixed(3)) })),
  };
}

function median(rows) {
  const values = rows.map((row) => row.nonIdleCpuMs).sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}

await main();
