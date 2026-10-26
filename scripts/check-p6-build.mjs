import { existsSync, readFileSync } from "node:fs";
const checks = [];
function check(name, condition, detail) {
  checks.push({ name, pass: Boolean(condition), detail });
  console.log(condition ? "PASS:" : "FAIL:", name, condition ? "" : detail ?? "");
}
const client = "apps/web/dist/client";
check("build: index.html", existsSync(`${client}/index.html`));
check("build: service worker", existsSync(`${client}/sw.js`) && readFileSync(`${client}/sw.js`, "utf8").includes("precacheAndRoute"), "sw.js missing");
const swText = readFileSync(`${client}/sw.js`, "utf8");
check("build: SW denylist excludes api/admin/static endpoints", ["/^\\/api\\//", "/^\\/admin\\//", "/^\\/(sitemap\\.xml|robots\\.txt|manifest\\.webmanifest)$/"].every((pattern) => swText.includes(pattern)), "denylist missing");

const sw = readFileSync(`${client}/sw.js`, "utf8");
const workboxBase = sw.match(/workbox-[a-f0-9]+/)?.[0];
const workboxFile = workboxBase ? `${workboxBase}.js` : null;
check("build: workbox runtime", Boolean(workboxFile && existsSync(`${client}/${workboxFile}`)), workboxFile ?? "no workbox import");
check("build: icon", existsSync(`${client}/icon.svg`));
const headers = existsSync(`${client}/_headers`) ? readFileSync(`${client}/_headers`, "utf8") : "";
check("build: _headers CSP", headers.includes("Content-Security-Policy") && headers.includes("challenges.cloudflare.com"), headers.slice(0, 200));
check("build: _headers asset cache", headers.includes("max-age=31536000"), headers);
const html = readFileSync(`${client}/index.html`, "utf8");
check("build: manifest link", html.includes('rel="manifest"'), html.slice(0, 300));
check("build: no .dev.vars in dist", !existsSync(`${client}/.dev.vars`));
const failed = checks.filter((row) => !row.pass);
console.log(JSON.stringify({ passed: checks.length - failed.length, failed: failed.length, checks }, null, 2));
if (failed.length) process.exitCode = 1;
