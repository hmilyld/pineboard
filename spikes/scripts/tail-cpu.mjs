// Measure real deployed Worker CPU via `wrangler tail` (the GraphQL
// cpuTimeP50 field is bucket-level and includes cold starts). Requires
// CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID in the environment.
//
//   CF_WORKER_NAME=pineboard node scripts/tail-cpu.mjs [url] [count]
import { spawn } from "node:child_process";

const url = process.argv[2] ?? "https://pineboard.pineboard.workers.dev/api/health";
const count = Number(process.argv[3] ?? 10);
const worker = process.env.CF_WORKER_NAME ?? "pineboard";
const root = new URL("../..", import.meta.url).pathname;

const child = spawn("pnpm", ["exec", "wrangler", "tail", worker, "--format", "json"], {
  cwd: root,
  env: {
    ...process.env,
    XDG_CONFIG_HOME: `${root}.config`,
    WRANGLER_LOG_PATH: `${root}.wrangler/logs`,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
child.stderr.on("data", (chunk) => process.stderr.write(chunk));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
await sleep(4000);

const walls = [];
for (let i = 0; i < count; i++) {
  const start = performance.now();
  const response = await fetch(url, { headers: { "cache-control": "no-cache" } });
  await response.arrayBuffer();
  walls.push(performance.now() - start);
  await sleep(150);
}

await sleep(5000);
child.kill("SIGTERM");

const cpu = [...output.matchAll(/"cpuTime":\s*(\d+)/g)].map((match) => Number(match[1]));
const tailWalls = [...output.matchAll(/"wallTime":\s*(\d+)/g)].map((match) => Number(match[1]));
const pct = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};
console.log(
  JSON.stringify(
    {
      url,
      requests: count,
      samples: cpu.length,
      cpuMs: { p50: pct(cpu, 50), p95: pct(cpu, 95), max: cpu.length ? Math.max(...cpu) : null, values: cpu },
      wallMsFromTail: { p50: pct(tailWalls, 50), p95: pct(tailWalls, 95) },
      clientWallMs: { p50: Number(pct(walls, 50)?.toFixed(1)), p95: Number(pct(walls, 95)?.toFixed(1)) },
    },
    null,
    2,
  ),
);
