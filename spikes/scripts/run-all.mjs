import { spawn, execFileSync } from "node:child_process";

const BASE = process.env.SPIKE_BASE ?? "http://127.0.0.1:8787";

async function healthy() {
  try {
    const response = await fetch(BASE + "/spike/health", { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

let child = null;
if (!(await healthy())) {
  console.log("starting wrangler dev...");
  child = spawn("pnpm", ["dev"], {
    env: {
      ...process.env,
      XDG_CONFIG_HOME: `${process.cwd()}/.config`,
      WRANGLER_LOG_PATH: `${process.cwd()}/.wrangler/logs`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  const deadline = Date.now() + 30_000;
  while (!(await healthy())) {
    if (Date.now() > deadline) {
      child.kill("SIGTERM");
      throw new Error("wrangler dev did not become healthy within 30s");
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

const suites = [
  ["Spike 2 (Better Auth + D1)", "scripts/spike2.mjs"],
  ["Spike 3 (FTS5 + CAS + floors)", "scripts/spike3.mjs"],
  ["Spike 1 (document meta + cache)", "scripts/spike1.mjs"],
  ["Spike 4 (R2 presign + HEAD)", "scripts/spike4.mjs"],
  ["Spike 5 (migration/backup/CI local half)", "scripts/spike5.mjs"],
  ["Migration FTS probe", "scripts/migration-probe.mjs"],
  ["Benchmark", "scripts/bench.mjs"],
];

const summary = [];
try {
  for (const [name, script] of suites) {
    console.log(`\n=== ${name} ===`);
    try {
      execFileSync(process.execPath, [script], { stdio: "inherit", env: process.env });
      summary.push({ name, pass: true });
    } catch (error) {
      summary.push({ name, pass: false, exitCode: error.status ?? 1 });
    }
  }
} finally {
  if (child) child.kill("SIGTERM");
}

console.log("\n=== summary ===");
for (const row of summary) console.log(`${row.pass ? "PASS" : "FAIL"} ${row.name}`);
const failed = summary.filter((row) => !row.pass);
console.log(`\n${summary.length - failed.length}/${summary.length} suites passed`);
if (failed.length) process.exitCode = 1;
