import { readFileSync } from "node:fs";

function parseJsonc(text) {
  // The production config is plain JSON. If comments are introduced, JSON.parse
  // intentionally fails so the CI check must be updated rather than silently stripped.
  return JSON.parse(text);
}

const configText = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const failures = [];
let config;
try {
  config = parseJsonc(configText);
} catch (error) {
  failures.push(`wrangler.jsonc is not valid JSONC: ${error instanceof Error ? error.message : String(error)}`);
}
if (config) {
  if (config.vars?.ENVIRONMENT !== "production") failures.push("wrangler.jsonc vars.ENVIRONMENT must be production");
  if (JSON.stringify(config).includes('"ENVIRONMENT":"development"')) failures.push("wrangler.jsonc must not contain ENVIRONMENT=development");
  if (JSON.stringify(config).includes('"TURNSTILE_SITE_KEY"')) failures.push("wrangler.jsonc must not ship a Turnstile site key");
  if (config.d1_databases?.[0]?.database_id !== "00000000-0000-0000-0000-000000000000") {
    failures.push("wrangler.jsonc must keep the placeholder D1 id; real ids belong in wrangler.site.jsonc");
  }
}
const deploy = String(packageJson.scripts?.deploy ?? "");
if (deploy.includes("ENVIRONMENT:development") || deploy.includes("ENVIRONMENT=development")) {
  failures.push("package.json deploy script must not override ENVIRONMENT to development");
}
if (!deploy.includes("wrangler.site.jsonc")) failures.push("package.json deploy script must use wrangler.site.jsonc");
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("wrangler deploy environment/default settings are safe");
