import { DatabaseSync } from "node:sqlite";
import { readdirSync } from "node:fs";
import { derivePassword } from "../packages/shared/src/config.ts";

const BASE = process.env.P6_BASE ?? "http://localhost:5173";
const DB_DIR = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";
const TURNSTILE = "XXXX.DUMMY.TOKEN.XXXX";
const results = [];
const siteInfo = await (await fetch(BASE + "/api/site")).json();
function assert(name, condition, detail) {
  results.push({ name, pass: Boolean(condition), detail });
  console.log(condition ? "PASS:" : "FAIL:", name, condition ? "" : JSON.stringify(detail ?? null).slice(0, 400));
}
function db() {
  const file = readdirSync(DB_DIR).find((name) => name.endsWith(".sqlite") && !name.startsWith("metadata"));
  if (!file) throw new Error("local D1 not found");
  return new DatabaseSync(`${DB_DIR}/${file}`);
}
function makeClient() {
  let cookie = "";
  async function request(path, options = {}) {
    const headers = new Headers(options.headers ?? {});
    headers.set("origin", BASE);
    headers.set("x-dev-reset-token", process.env.DEV_RESET_TOKEN ?? "local-dev-reset");
    if (cookie) headers.set("cookie", cookie);
    if (options.json !== undefined) headers.set("content-type", "application/json");
    const response = await fetch(BASE + path, {
      method: options.method ?? (options.json !== undefined ? "POST" : "GET"),
      headers,
      body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
    });
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";");
      const [name, value] = pair.split("=");
      if (value && !/max-age=0/i.test(raw)) cookie = `${name}=${value}`;
    }
    const text = await response.text();
    let body;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: response.status, body, headers: response.headers };
  }
  return { request };
}
async function outbox(email, category, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const handle = db();
    const row = handle.prepare("SELECT payload_json FROM dev_email_outbox WHERE to_email = ? AND category = ? ORDER BY created_at DESC LIMIT 1").get(email, category);
    handle.close();
    if (row) return JSON.parse(row.payload_json);
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}
async function signup(client, email, name, username) {
  const password = await derivePassword(email, "correct horse battery staple");
  const response = await client.request("/api/auth/sign-up/email", {
    json: { email, password, name, username },
    headers: { "x-turnstile-token": TURNSTILE },
  });
  return { response, password };
}
async function verify(client, email) {
  const mail = await outbox(email, "verification");
  if (!mail) throw new Error(`no mail for ${email}`);
  return client.request(`/api/auth/verify-email?token=${encodeURIComponent(mail.token)}`);
}


async function patchSettings(client, patch) {
  const current = await client.request("/api/admin/settings");
  return client.request("/api/admin/settings", { method: "PATCH", json: { version: current.body?.data?.version, patch } });
}

const admin = makeClient();
const author = makeClient();
await admin.request("/api/dev/reset", { method: "POST" });
await signup(admin, "admin@example.test", "Admin", `adm${Date.now().toString(36)}`.slice(0, 18));
await verify(admin, "admin@example.test");
await patchSettings(admin, { security: { postMinIntervalSeconds: 0 }, account: { registrationOpen: true }, seo: { noindex: false, sitemapEnabled: true } },);

const email = `p6-${Date.now()}@example.test`;
const username = `p6${Date.now().toString(36)}`.slice(0, 18);
await signup(author, email, "P6 Author", username);
await verify(author, email);
const categories = await author.request("/api/categories");
const topic = await author.request("/api/topics", {
  json: { categoryId: categories.body.data[0].id, title: "P6 文档注入测试", contentMd: "这是用于 P6 meta 注入的摘要。", tagIds: [] },
  headers: { "x-turnstile-token": TURNSTILE },
});
assert("seed topic", topic.status === 201, topic.body);
const topicId = topic.body.data.id;

const editShell = await fetch(BASE + `/t/${topicId}/edit`);
const editShellHtml = await editShell.text();
assert("doc: edit sub-route returns SPA shell", editShell.status === 200 && editShellHtml.includes('id="app"'), editShell.status);

const first = await author.request(`/t/${topicId}`);
const second = await author.request(`/t/${topicId}`);
const html = typeof first.body === "string" ? first.body : JSON.stringify(first.body);
assert("doc: title/meta/canonical injected", html.includes("P6 文档注入测试") && html.includes('rel="canonical"') && html.includes(`P6 文档注入测试 · ${siteInfo.data.site.name}`), html.slice(0, 300));
assert("doc: JSON-LD injected", html.includes("DiscussionForumPosting"), html.slice(0, 300));
assert("doc: CSP header present", Boolean(first.headers.get("content-security-policy")?.includes("challenges.cloudflare.com")), first.headers.get("content-security-policy"));
assert("doc: first miss then cache hit", first.headers.get("x-doc-cache") === "miss" && second.headers.get("x-doc-cache") === "hit", { a: first.headers.get("x-doc-cache"), b: second.headers.get("x-doc-cache") });

const missing = await fetch(BASE + "/t/does-not-exist");
const missingHtml = await missing.text();
// Server-rendered copy follows `site.language`, so assert against the configured
// language instead of a hard-coded Chinese phrase.
const missingTitle = (await author.request("/api/site")).body?.data?.site?.language === "en" ? "Topic not found" : "主题不存在";
assert("doc: missing 404 shell", missing.status === 404 && missingHtml.includes(missingTitle), missing.status);
const homeDoc = await fetch(BASE + "/");
const homeHtml = await homeDoc.text();
assert("doc: home SEO meta", homeHtml.includes('"@type":"WebSite"') && homeHtml.includes('property="og:type" content="website"') && homeHtml.includes('name="robots" content="index,follow"'), homeHtml.slice(0, 300));
const categoryDoc = await fetch(BASE + "/c/general");
assert("doc: category meta", (await categoryDoc.text()).includes("综合讨论"));
const userDoc = await fetch(BASE + `/u/${username}`);
assert("doc: user meta", (await userDoc.text()).includes("P6 Author"));
const tagDoc = await fetch(BASE + "/tag/guide");
assert("doc: tag meta", (await tagDoc.text()).includes("#攻略"));

const sitemap = await (await fetch(BASE + "/sitemap.xml")).text();
assert("seo: sitemap includes topic", sitemap.includes(`/t/${topicId}`) && sitemap.includes("<urlset"), sitemap.slice(0, 200));
assert("seo: sitemap includes home/categories/tags", sitemap.includes(`${siteInfo.data.site.url.replace(/\/$/, "")}/tags`) && sitemap.includes("/c/general") && sitemap.includes("/tag/guide"), sitemap.slice(0, 500));
const robots = await (await fetch(BASE + "/robots.txt")).text();
assert("seo: robots excludes private routes", robots.includes("Disallow: /api/") && robots.includes("Disallow: /search") && robots.includes("Disallow: /new") && robots.includes("Sitemap:"), robots);
const manifest = await (await fetch(BASE + "/manifest.webmanifest")).json();
assert("seo: manifest name/start_url/icons", manifest.name === siteInfo.data.site.name && manifest.start_url === "/" && Array.isArray(manifest.icons) && manifest.icons.length > 0, manifest);

// Title injection must be escaped in the document shell.
const xss = await author.request("/api/topics", {
  json: { categoryId: categories.body.data[0].id, title: "<img src=x onerror=alert(1)>", contentMd: "xss", tagIds: [] },
  headers: { "x-turnstile-token": TURNSTILE },
});
const xssDoc = await (await fetch(BASE + `/t/${xss.body.data.id}`)).text();
const xssTitle = xssDoc.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "";
assert("doc: title is HTML-escaped", !xssTitle.includes("<img") && xssTitle.includes("&lt;img"), xssTitle);

// Hidden content must not leak in doc or sitemap.
const hidden = await author.request("/api/topics", {
  json: { categoryId: categories.body.data[0].id, title: "隐藏机密标题", contentMd: "隐藏内容", tagIds: [] },
  headers: { "x-turnstile-token": TURNSTILE },
});
{
  const handle = db();
  handle.prepare("UPDATE topics SET status = 'hidden' WHERE id = ?").run(hidden.body.data.id);
  handle.close();
}
const hiddenDoc = await fetch(BASE + `/t/${hidden.body.data.id}`);
const hiddenHtml = await hiddenDoc.text();
const afterSitemap = await (await fetch(BASE + "/sitemap.xml")).text();
assert("doc: hidden 404 without title leak", hiddenDoc.status === 404 && !hiddenHtml.includes("隐藏机密标题"), hiddenDoc.status);
assert("seo: hidden excluded from sitemap", !afterSitemap.includes(hidden.body.data.id), afterSitemap.includes(hidden.body.data.id));

// Soft delete = 410 shell.
await author.request(`/api/topics/${topicId}`, { method: "DELETE" });
const gone = await fetch(BASE + `/t/${topicId}`);
assert("doc: deleted 410 shell", gone.status === 410, gone.status);

const daily = await admin.request("/api/admin/maintenance/daily", { method: "POST" });
assert("maintenance: daily cleanup/reconcile", daily.status === 200 && daily.body.data.reconciled === true, daily.body);

await admin.request("/api/dev/reset", { method: "POST" });
const failed = results.filter((row) => !row.pass);
console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results }, null, 2));
if (failed.length) process.exitCode = 1;
