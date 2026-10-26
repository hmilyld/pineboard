import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/check-worker-secrets.mjs <wrangler-secret-list.json>");
  process.exit(2);
}
let secrets;
try {
  secrets = JSON.parse(readFileSync(file, "utf8"));
} catch (error) {
  console.error(`cannot parse Worker secret list: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
const present = new Set((Array.isArray(secrets) ? secrets : []).map((item) => item?.name).filter(Boolean));
const required = ["BETTER_AUTH_SECRET", "PASSWORD_PEPPER", "IP_HASH_SALT"];
const missing = required.filter((name) => !present.has(name));
for (const name of ["TURNSTILE_SECRET", "RESEND_API_KEY", "ADMIN_EMAILS"]) {
  if (!present.has(name)) console.warn(`optional Worker secret not configured: ${name}`);
}
if (missing.length) {
  console.error(`missing required Worker secrets: ${missing.join(", ")}`);
  process.exit(1);
}
console.log(`required Worker secrets present: ${required.join(", ")}`);
