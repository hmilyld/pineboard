import { BASE, derivePassword, inspect, json, makeClient, parseToken, reset, saveResults, trace, waitForOutbox } from "./lib.mjs";

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function summary(values) {
  return {
    n: values.length,
    p50: Number(percentile(values, 50).toFixed(2)),
    p95: Number(percentile(values, 95).toFixed(2)),
    max: Number(Math.max(...values).toFixed(2)),
  };
}

async function waitForOutboxFor(kind, email, timeoutMs = 2500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const data = await inspect();
    const hit = data.outbox.find((row) => {
      if (row.kind !== kind) return false;
      try {
        return JSON.parse(row.payload).email === email;
      } catch {
        return false;
      }
    });
    if (hit) return hit;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return null;
}

async function clearRateLimit() {
  await fetch(BASE + "/spike/ratelimit/clear", { method: "POST" });
}

async function bench(name, iterations, fn) {
  const walls = [];
  const serverWalls = [];
  const rowsRead = [];
  const rowsWritten = [];
  const statements = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    const result = await fn(i);
    walls.push(performance.now() - start);
    if (result?.serverWall) serverWalls.push(Number(result.serverWall));
    if (result?.trace) {
      rowsRead.push(result.trace.rowsRead);
      rowsWritten.push(result.trace.rowsWritten);
      statements.push(result.trace.statements);
    }
  }
  return {
    name,
    iterations,
    clientWall: summary(walls),
    serverWall: serverWalls.length ? summary(serverWalls) : null,
    d1RowsReadPerRequest: rowsRead.length ? summary(rowsRead) : null,
    d1RowsWrittenPerRequest: rowsWritten.length ? summary(rowsWritten) : null,
    statementsPerRequest: statements.length ? summary(statements) : null,
  };
}

const cpuProbe = await (await fetch(BASE + "/spike/cpu/probe")).json();
await reset();
await clearRateLimit();

const signup = await bench("signup", 5, async (i) => {
  await clearRateLimit();
  const email = `bench-signup-${i}@example.test`;
  const password = await derivePassword(email, "bench password is long enough");
  const client = makeClient();
  const response = await client.request("/api/auth/sign-up/email", { json: { email, password, name: `Bench ${i}` } });
  await json(response);
  return { serverWall: response.headers.get("x-spike-wall-ms"), trace: await trace() };
});

await reset();
const signupEmail = "bench-signin@example.test";
const signupPassword = await derivePassword(signupEmail, "bench password is long enough");
await makeClient().request("/api/auth/sign-up/email", { json: { email: signupEmail, password: signupPassword, name: "Bench" } });
const verify = await waitForOutbox("verify");
await makeClient().request(`/api/auth/verify-email?token=${encodeURIComponent(parseToken(verify))}`);

const signin = await bench("signin", 10, async () => {
  await clearRateLimit();
  const response = await makeClient().request("/api/auth/sign-in/email", { json: { email: signupEmail, password: signupPassword } });
  await json(response);
  return { serverWall: response.headers.get("x-spike-wall-ms"), trace: await trace() };
});

const resetFlow = await bench("password-reset", 3, async (i) => {
  await clearRateLimit();
  const email = `bench-reset-${i}@example.test`;
  const oldPassword = await derivePassword(email, "old bench password is long enough");
  const newPassword = await derivePassword(email, "new bench password is long enough");
  const client = makeClient();
  await client.request("/api/auth/sign-up/email", { json: { email, password: oldPassword, name: `Reset ${i}` } });
  const verification = await waitForOutboxFor("verify", email);
  await client.request(`/api/auth/verify-email?token=${encodeURIComponent(parseToken(verification))}`);
  await clearRateLimit();
  const requestReset = await client.request("/api/auth/request-password-reset", { json: { email, redirectTo: "/reset-password" } });
  await json(requestReset);
  const resetToken = await waitForOutboxFor("reset", email);
  if (!resetToken) throw new Error(`no reset token for ${email}`);
  const response = await client.request("/api/auth/reset-password", {
    json: { token: parseToken(resetToken), newPassword },
  });
  await json(response);
  return { serverWall: response.headers.get("x-spike-wall-ms"), trace: await trace() };
});

await reset();
const seedTopic = async (id, title) => {
  const response = await fetch(BASE + "/spike/fts/seed", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, title, content: `${title} 的正文内容，用于冷缓存文档请求。` }),
  });
  return (await response.json()).data;
};

const docMiss = await bench("doc-miss", 10, async (i) => {
  const topic = await seedTopic(`bench-doc-${i}`, `基准主题 ${i}`);
  await fetch(`${BASE}/spike/cache/flush?id=${topic.topicId}`);
  const response = await fetch(`${BASE}/t/${topic.topicId}`);
  await response.text();
  return { serverWall: /total;dur=([\d.]+)/.exec(response.headers.get("server-timing") ?? "")?.[1] };
});

const docHit = await bench("doc-cache-hit", 100, async () => {
  const response = await fetch(`${BASE}/t/bench-doc-0`);
  await response.text();
  return { serverWall: /total;dur=([\d.]+)/.exec(response.headers.get("server-timing") ?? "")?.[1] };
});

const fts = await bench("fts-search", 20, async (i) => {
  const response = await fetch(`${BASE}/spike/fts/search?q=${encodeURIComponent(i % 2 ? "基准主题" : "Elden Ring 攻略")}`);
  const body = await json(response);
  return { serverWall: undefined, trace: { rowsRead: body.data.meta?.rows_read, rowsWritten: body.data.meta?.rows_written, statements: 1 } };
});

const report = {
  environment: {
    runtime: "wrangler dev / workerd local",
    note: "No Cloudflare API token in this environment. Server wall time is an upper bound on CPU; billable CPU must be read from Cloudflare GraphQL after deploy.",
    processCpuUsageAvailable: cpuProbe.data.cpuUsageAvailable,
  },
  cpuProxy: cpuProbe.data,
  flows: [signup, signin, resetFlow, docMiss, docHit, fts],
  observedState: (await inspect()).counts,
};
console.log(JSON.stringify(report, null, 2));
saveResults("bench.json", report);
