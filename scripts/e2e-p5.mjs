import { DatabaseSync } from "node:sqlite";
import { readdirSync } from "node:fs";
import { derivePassword } from "../packages/shared/src/config.ts";

const BASE = process.env.P5_BASE ?? "http://localhost:5173";
const DB_DIR = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";
const TURNSTILE = "XXXX.DUMMY.TOKEN.XXXX";
const results = [];

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
  return { request, get cookie() { return cookie; } };
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
const reporter = makeClient();
await admin.request("/api/dev/reset", { method: "POST" });
await signup(admin, "admin@example.test", "Admin", `adm${Date.now().toString(36)}`.slice(0, 18));
await verify(admin, "admin@example.test");
await patchSettings(admin, {
    security: { postMinIntervalSeconds: 0 },
    account: { registrationOpen: true },
    feature: { search: true },
    edit: { lockAfterReply: false, requireReason: false, windowUserMinutes: 60, historyVisibility: "author" },
  },);

const authorEmail = `p5a-${Date.now()}@example.test`;
const authorName = `p5a${Date.now().toString(36)}`.slice(0, 18);
const authorSignup = await signup(author, authorEmail, "P5 Author", authorName);
await verify(author, authorEmail);
const reporterEmail = `p5b-${Date.now()}@example.test`;
await signup(reporter, reporterEmail, "P5 Reporter", `p5b${Date.now().toString(36)}`.slice(0, 16));
await verify(reporter, reporterEmail);

const categories = await author.request("/api/categories");
const topic = await author.request("/api/topics", {
  json: { categoryId: categories.body.data[0].id, title: "游戏攻略分享", contentMd: "Elden Ring 攻略：先击败接肢贵族，再前往魔法学院。", tagIds: [] },
  headers: { "x-turnstile-token": TURNSTILE },
});
assert("topic created", topic.status === 201, topic.body);
const topicId = topic.body.data.id;
const reply = await author.request(`/api/topics/${topicId}/posts`, {
  json: { contentMd: "补充：魔法学院路线。" },
  headers: { "x-turnstile-token": TURNSTILE },
});
assert("reply created", reply.status === 201, reply.body);

const reindex = await admin.request("/api/admin/search/reindex", { method: "POST" });
assert("search reindex", reindex.status === 200 && reindex.body.data.posts >= 2, reindex.body);

const searchChinese = await author.request("/api/search?q=" + encodeURIComponent("游戏攻略"));
assert("search: Chinese bigram hits", searchChinese.status === 200 && searchChinese.body.data.items.length >= 1, searchChinese.body);
const searchMixed = await author.request("/api/search?q=" + encodeURIComponent("Elden Ring 攻略"));
assert("search: mixed phrase hits", searchMixed.body.data.items.length >= 1, searchMixed.body);
const searchOne = await author.request("/api/search?q=" + encodeURIComponent("攻"));
assert("search: single CJK falls back to LIKE", searchOne.body.data.mode === "like", searchOne.body);
const searchInjection = await author.request("/api/search?q=" + encodeURIComponent('" OR "'));
assert("search: injection is safe", searchInjection.status === 200, searchInjection.body);

const detail = await author.request(`/api/topics/${topicId}`);
const edit = await author.request(`/api/topics/${topicId}`, {
  method: "PATCH",
  json: { version: detail.body.data.firstPost.version, title: "只狼攻略", contentMd: "苇名一心攻略，完全不同的内容。" },
});
assert("topic edit for FTS", edit.status === 200, edit.body);
const newSearch = await author.request("/api/search?q=" + encodeURIComponent("只狼"));
const oldSearch = await author.request("/api/search?q=" + encodeURIComponent("Elden"));
assert("search: edited content indexed", newSearch.body.data.items.length >= 1, newSearch.body);
assert("search: old content removed", oldSearch.body.data.items.length === 0, oldSearch.body);

const deleteReply = await author.request(`/api/posts/${reply.body.data.id}`, { method: "DELETE" });
assert("reply deleted", deleteReply.status === 200, deleteReply.body);
const deletedSearch = await author.request("/api/search?q=" + encodeURIComponent("魔法学院"));
assert("search: deleted reply removed", deletedSearch.body.data.items.length === 0, deletedSearch.body);

// Reports
const report = await reporter.request("/api/reports", { json: { targetType: "topic", targetId: topicId, reasonCode: "spam", detail: "测试举报" } });
assert("report: create", report.status === 201, report.body);
const duplicate = await reporter.request("/api/reports", { json: { targetType: "topic", targetId: topicId, reasonCode: "spam", detail: "重复" } });
assert("report: duplicate pending rejected", duplicate.status === 409, duplicate.body);
const reports = await admin.request("/api/mod/reports");
assert("report: moderator list", reports.status === 200 && reports.body.data.items.some((r) => r.id), reports.body);
const reportId = reports.body.data.items[0].id;
const resolve = await admin.request(`/api/mod/reports/${reportId}/resolve`, { method: "POST", json: { status: "resolved", resolutionNote: "已处理" } });
assert("report: resolve", resolve.status === 200, resolve.body);
const reporterNotifications = await reporter.request("/api/me/notifications");
assert("report: reporter notified", reporterNotifications.body.data.items.some((n) => n.type === "moderation"), reporterNotifications.body);

// Account export/delete/cancel/anonymize
const exportResponse = await fetch(BASE + "/api/me/export", { method: "POST", headers: { origin: BASE, cookie: author.cookie } });
const exported = await exportResponse.json();
assert("account: export includes content", exportResponse.status === 200 && exported.topics.length >= 1, { status: exportResponse.status });
const wrongDelete = await author.request("/api/me/delete", { json: { password: await derivePassword(authorEmail, "wrong password") } });
assert("account: wrong password rejected", wrongDelete.status === 403, wrongDelete.body);
const deleteAccount = await author.request("/api/me/delete", { json: { password: await derivePassword(authorEmail, "correct horse battery staple") } });
assert("account: delete enters grace period", deleteAccount.status === 200, deleteAccount.body);
const afterDeleteMe = await author.request("/api/me");
assert("account: sessions revoked", afterDeleteMe.status === 401, afterDeleteMe.body);
const loginAfterDelete = await author.request("/api/auth/sign-in/email", { json: { email: authorEmail, password: await derivePassword(authorEmail, "correct horse battery staple") } });
assert("account: login during grace succeeds", loginAfterDelete.status === 200, loginAfterDelete.body);
const restoredMe = await author.request("/api/me");
assert("account: login does not silently cancel deletion", restoredMe.status === 200 && restoredMe.body.data.user.status === "deleting", restoredMe.body);
const cancelDelete = await author.request("/api/me/delete/cancel", { method: "POST" });
assert("account: explicit cancel restores account", cancelDelete.status === 200 && cancelDelete.body.data.cancelled === true, cancelDelete.body);
const activeMe = await author.request("/api/me");
assert("account: cancel makes user active", activeMe.body.data.user.status === "active", activeMe.body);

// Delete again and force the grace period to expire.
await author.request("/api/me/delete", { json: { password: await derivePassword(authorEmail, "correct horse battery staple") } });
{
  const handle = db();
  handle.prepare("UPDATE user SET deleted_at = ? WHERE email = ?").run(Math.floor(Date.now() / 1000) - 8 * 86400, authorEmail);
  handle.close();
}
const cleanup = await admin.request("/api/admin/maintenance/cleanup", { method: "POST" });
assert("account: cleanup runs", cleanup.status === 200 && cleanup.body.data.anonymized >= 1, cleanup.body);
{
  const handle = db();
  const row = handle.prepare("SELECT name, email, status FROM user WHERE id = ?").get(authorSignup.response.body.user.id);
  const topicRow = handle.prepare("SELECT COUNT(*) AS n FROM topics WHERE id = ?").get(topicId);
  handle.close();
  assert("account: user anonymized and content kept", row.status === "deleted" && row.email.startsWith("deleted+") && Number(topicRow.n) === 1, row);
}

await admin.request("/api/dev/reset", { method: "POST" });
const failed = results.filter((row) => !row.pass);
console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results }, null, 2));
if (failed.length) process.exitCode = 1;
