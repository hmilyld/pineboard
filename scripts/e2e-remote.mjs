import { execFileSync } from "node:child_process";
import { derivePassword } from "../packages/shared/src/config.ts";

const BASE = process.env.REMOTE_BASE;
if (!BASE) {
  console.error("REMOTE_BASE is required, e.g. REMOTE_BASE=https://forum.example.com pnpm test:e2e:remote");
  process.exit(2);
}
const D1_DATABASE_NAME = process.env.D1_DATABASE_NAME ?? "pineboard";
const TURNSTILE = "XXXX.DUMMY.TOKEN.XXXX";
const PASSWORD_RAW = "correct horse battery staple";
const results = [];
const siteInfo = await (await fetch(BASE + "/api/site")).json();
const siteName = siteInfo.data.site.name;

function assert(name, condition, detail) {
  results.push({ name, pass: Boolean(condition), detail });
  console.log(condition ? "PASS:" : "FAIL:", name, condition ? "" : JSON.stringify(detail ?? null).slice(0, 500));
}

function remoteSql(sql) {
  const output = execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", D1_DATABASE_NAME, "--remote", "--json", "--command", sql], {
    cwd: process.cwd(),
    env: { ...process.env, XDG_CONFIG_HOME: `${process.cwd()}/.config`, WRANGLER_LOG_PATH: `${process.cwd()}/.wrangler/logs` },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(output)[0].results;
}

async function outbox(email, category, timeout = 8000) {
  const deadline = Date.now() + timeout;
  const safe = email.replaceAll("'", "''");
  while (Date.now() < deadline) {
    const rows = remoteSql(
      `SELECT payload_json FROM dev_email_outbox WHERE to_email = '${safe}' AND category = '${category}' ORDER BY created_at DESC LIMIT 1`,
    );
    if (rows.length) return JSON.parse(rows[0].payload_json);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return null;
}

function makeClient() {
  let cookie = "";
  async function request(path, options = {}) {
    const headers = new Headers(options.headers ?? {});
    headers.set("origin", BASE);
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
  return { request, get cookie() { return cookie; } };
}

async function signup(client, email, name, username) {
  const password = await derivePassword(email, PASSWORD_RAW);
  const response = await client.request("/api/auth/sign-up/email", {
    json: { email, password, name, username },
    headers: { "x-turnstile-token": TURNSTILE },
  });
  if (response.status === 200 || response.status === 201) return { response, password, created: true };
  if (response.status === 422 || response.status === 409) {
    const login = await client.request("/api/auth/sign-in/email", { json: { email, password } });
    return { response: login, password, created: false };
  }
  return { response, password, created: false };
}

async function verify(client, email) {
  const mail = await outbox(email, "verification");
  if (!mail) throw new Error(`no remote verification mail for ${email}`);
  return client.request(`/api/auth/verify-email?token=${encodeURIComponent(mail.token)}`);
}


async function patchSettings(client, patch) {
  const current = await client.request("/api/admin/settings");
  return client.request("/api/admin/settings", { method: "PATCH", json: { version: current.body?.data?.version, patch } });
}

const admin = makeClient();
const author = makeClient();
const reporter = makeClient();

const adminSignup = await signup(admin, "admin@example.test", "Remote Admin", "remoteadmin");
assert("remote: admin signup/login", adminSignup.response.status === 200 || adminSignup.response.status === 201, adminSignup.response.body);
if (adminSignup.created) await verify(admin, "admin@example.test");
const adminMe = await admin.request("/api/me");
assert("remote: admin promoted", adminMe.status === 200 && adminMe.body.data.user.role === "admin", adminMe.body);

const config = await patchSettings(admin, {
    mail: { enabled: true, digestWindowMinutes: 5 },
    security: { postMinIntervalSeconds: 0, signupPerHour: 50 },
    account: { registrationOpen: true },
    feature: { search: true, reports: true, guestRead: true },
    edit: { lockAfterReply: false, requireReason: false, windowUserMinutes: 60 },
    seo: { noindex: false, sitemapEnabled: true },
  },);
assert("remote: admin settings write", config.status === 200, config.body);
await new Promise((resolve) => setTimeout(resolve, 6000));

const suffix = Date.now().toString(36);
const authorEmail = `remote-a-${suffix}@example.test`;
const authorName = `ra${suffix}`.slice(0, 18);
const authorSignup = await signup(author, authorEmail, "Remote Author", authorName);
assert("remote: author signup", authorSignup.response.status === 200 || authorSignup.response.status === 201, authorSignup.response.body);
await verify(author, authorEmail);
const reporterEmail = `remote-b-${suffix}@example.test`;
const reporterSignup = await signup(reporter, reporterEmail, "Remote Reporter", `rb${suffix}`.slice(0, 18));
assert("remote: reporter signup", reporterSignup.response.status === 200 || reporterSignup.response.status === 201, reporterSignup.response.body);
await verify(reporter, reporterEmail);

const categories = await author.request("/api/categories");
const topic = await author.request("/api/topics", {
  json: { categoryId: categories.body.data[0].id, title: "远程冒烟主题", contentMd: "远程部署后的第一条主题，包含中文搜索词。", tagIds: [] },
  headers: { "x-turnstile-token": TURNSTILE },
});
assert("remote: topic create", topic.status === 201, topic.body);
const topicId = topic.body.data.id;
const reply = await reporter.request(`/api/topics/${topicId}/posts`, {
  json: { contentMd: "远程回复：部署成功。" },
  headers: { "x-turnstile-token": TURNSTILE },
});
assert("remote: reply create", reply.status === 201, reply.body);

const authorNotifications = await author.request("/api/me/notifications");
assert("remote: reply notification", authorNotifications.body?.data?.items?.some((item) => item.type === "topic_reply"), authorNotifications.body);

const reindex = await admin.request("/api/admin/search/reindex", { method: "POST" });
assert("remote: search reindex", reindex.status === 200 && reindex.body.data.posts >= 2, reindex.body);
const search = await author.request(`/api/search?q=${encodeURIComponent("远程冒烟")}`);
assert("remote: Chinese search", search.status === 200 && search.body.data.items.length >= 1, search.body);

const detail = await author.request(`/api/topics/${topicId}`);
const edit = await author.request(`/api/topics/${topicId}`, {
  method: "PATCH",
  json: { version: detail.body.data.firstPost.version, title: "远程冒烟主题（已编辑）", contentMd: "编辑后的远程内容，用于版本与 FTS 验证。" },
});
assert("remote: topic edit", edit.status === 200, edit.body);
const stale = await author.request(`/api/topics/${topicId}`, {
  method: "PATCH",
  json: { version: detail.body.data.firstPost.version, title: "旧版本不应成功", contentMd: "stale" },
});
assert("remote: stale edit 409", stale.status === 409, stale.body);
const revisions = await author.request(`/api/topics/${topicId}/revisions`);
assert("remote: revisions", revisions.status === 200 && revisions.body.data.length >= 1, revisions.body);
const editedSearch = await admin.request(`/api/admin/search/reindex`, { method: "POST" });
assert("remote: reindex after edit", editedSearch.status === 200, editedSearch.body);
const newSearch = await author.request(`/api/search?q=${encodeURIComponent("编辑后的远程")}`);
assert("remote: edited FTS", newSearch.body.data.items.length >= 1, newSearch.body);

const report = await reporter.request("/api/reports", {
  json: { targetType: "topic", targetId: topicId, reasonCode: "spam", detail: "远程冒烟举报" },
});
assert("remote: report create", report.status === 201, report.body);
const reports = await admin.request("/api/mod/reports");
assert("remote: report queue", reports.status === 200 && reports.body.data.items.length >= 1, reports.body);
const reportId = reports.body.data.items[0]?.id;
const resolved = await admin.request(`/api/mod/reports/${reportId}/resolve`, {
  method: "POST",
  json: { status: "resolved", resolutionNote: "远程冒烟处理" },
});
assert("remote: report resolve", resolved.status === 200, resolved.body);

const digest = await admin.request("/api/admin/emails/digest", { method: "POST" });
assert("remote: digest runs", digest.status === 200, digest.body);
const digestMail = await outbox(authorEmail, "digest");
assert("remote: dev outbox digest", Boolean(digestMail?.subject?.includes("新通知")), digestMail?.subject);
const unsubToken = digestMail?.text?.match(/\/unsubscribe\?token=([A-Za-z0-9_-]+)/)?.[1];
const unsubPreview = unsubToken ? await author.request(`/api/unsubscribe/preview?token=${encodeURIComponent(unsubToken)}`) : { status: 0, body: null };
assert("remote: unsubscribe preview", unsubPreview.status === 200, unsubPreview.body);
const unsub = unsubToken ? await author.request("/api/unsubscribe", { method: "POST", json: { token: unsubToken } }) : { status: 0, body: null };
assert("remote: unsubscribe apply", unsub.status === 200, unsub.body);

const exportResponse = await fetch(BASE + "/api/me/export", { method: "POST", headers: { origin: BASE, cookie: author.cookie } });
const exported = await exportResponse.json().catch(() => null);
assert("remote: account export", exportResponse.status === 200 && exported?.topics?.length >= 1, { status: exportResponse.status });

const temp = makeClient();
const tempEmail = `remote-d-${suffix}@example.test`;
const tempSignup = await signup(temp, tempEmail, "Remote Delete", `rd${suffix}`.slice(0, 18));
assert("remote: temp signup", tempSignup.response.status === 200 || tempSignup.response.status === 201, tempSignup.response.body);
await verify(temp, tempEmail);
const deleteResponse = await temp.request("/api/me/delete", { json: { password: await derivePassword(tempEmail, PASSWORD_RAW) } });
assert("remote: account delete request", deleteResponse.status === 200, deleteResponse.body);
const restoreLogin = await temp.request("/api/auth/sign-in/email", { json: { email: tempEmail, password: await derivePassword(tempEmail, PASSWORD_RAW) } });
assert("remote: login during grace succeeds", restoreLogin.status === 200, restoreLogin.body);
const pendingDelete = await temp.request("/api/me");
assert("remote: login does not auto-cancel deletion", pendingDelete.status === 200 && pendingDelete.body.data.user.status === "deleting", pendingDelete.body);
const cancelDelete = await temp.request("/api/me/delete/cancel", { method: "POST" });
assert("remote: explicit cancel", cancelDelete.status === 200 && cancelDelete.body.data.cancelled === true, cancelDelete.body);
const restored = await temp.request("/api/me");
assert("remote: account restored", restored.status === 200 && restored.body.data.user.status === "active", restored.body);

const manifest = await (await fetch(BASE + "/manifest.webmanifest")).json();
assert("remote: manifest", manifest.name === siteName && manifest.start_url === "/", manifest);
const sitemap = await (await fetch(BASE + "/sitemap.xml")).text();
assert("remote: sitemap includes topic", sitemap.includes(`/t/${topicId}`), sitemap.slice(0, 300));
const doc = await (await fetch(BASE + `/t/${topicId}`)).text();
assert("remote: document meta", doc.includes(`<title>远程冒烟主题（已编辑） · ${siteName}</title>`), doc.match(/<title>.*?<\/title>/)?.[0]);
const home = await fetch(BASE + "/");
assert("remote: security headers", Boolean(home.headers.get("content-security-policy")?.includes("challenges.cloudflare.com")), home.headers.get("content-security-policy"));
const health = await (await fetch(BASE + "/api/health")).json();
assert("remote: health db/r2", health.ok === true && health.data.db === true && health.data.r2 === true, health);

const cleanup = await admin.request("/api/admin/maintenance/daily", { method: "POST" });
assert("remote: daily maintenance", cleanup.status === 200 && cleanup.body.data.reconciled === true, cleanup.body);

const failed = results.filter((row) => !row.pass);
console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results }, null, 2));
if (failed.length) process.exitCode = 1;
