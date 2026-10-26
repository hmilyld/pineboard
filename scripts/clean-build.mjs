import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

// The Cloudflare Vite plugin copies .dev.vars into the Worker build output for
// local preview. It must never survive into a deployable artifact.
const roots = ["apps/web/dist", "dist"];

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path);
    else if (entry === ".dev.vars" || entry === ".env" || entry.startsWith(".env.")) {
      rmSync(path, { force: true });
      console.log(`removed build-time secret file ${path}`);
    }
  }
}

for (const root of roots) walk(root);
