// Fails when a production dependency is not under a permissive license.
// Run after `pnpm install`; reads the installed tree, no network needed.
import { execFileSync } from "node:child_process";

const ALLOWED = new Set([
  "0BSD",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC0-1.0",
  "ISC",
  "MIT",
  "MPL-2.0",
  "PSF-2.0",
  "Python-2.0",
  "Unlicense",
  "Zlib",
]);

const raw = execFileSync("pnpm", ["licenses", "list", "--prod", "--json"], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
const byLicense = JSON.parse(raw);

const failures = [];
let packages = 0;
for (const [expression, entries] of Object.entries(byLicense)) {
  const options = expression
    .replace(/[()]/g, "")
    .split(/\s+OR\s+/i)
    .map((value) => value.trim());
  packages += entries.length;
  if (options.some((option) => ALLOWED.has(option))) continue;
  for (const entry of entries) failures.push(`${entry.name} -> ${expression}`);
}

if (failures.length) {
  console.error("Disallowed production dependency licenses:");
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(`license check passed (${packages} production packages)`);
