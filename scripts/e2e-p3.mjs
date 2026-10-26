import { DatabaseSync } from "node:sqlite";
import { readdirSync } from "node:fs";
import { derivePassword } from "../packages/shared/src/config.ts";

const BASE = process.env.P3_BASE ?? "http://localhost:5173";
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
  let last = null;
  async function request(path, options = {}) {
    const headers = new Headers(options.headers ?? {});
    headers.set("origin", BASE);
    headers.set("x-dev-reset-token", process.env.DEV_RESET_TOKEN ?? "local-dev-reset");
    if (cookie) headers.set("cookie", cookie);
    if (options.json !== undefined) headers.set("content-type", "application/json");
    const response = await fetch(BASE + path, {
      method: options.method ?? (options.json !== undefined ? "POST" : "GET"),
      headers,
      body: options.json !== undefined ? JSON.stringify(options.json) : undefined,
    });
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = raw.split(";");
      const [name, value] = pair.split("=");
      if (/max-age=0/i.test(raw) || !value) continue;
      cookie = `${name}=${value}`;
      last = { raw, attrs: attrs.map((a) => a.trim()) };
    }
    const text = await response.text();
    let body;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
    return { status: response.status, body, last };
  }
  return { request, get cookie() { return cookie; } };
}

async function waitOutbox(email, category, timeout = 3000) {
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
  const mail = await waitOutbox(email, "verification");
  if (!mail) throw new Error(`no mail for ${email}`);
  return client.request(`/api/auth/verify-email?token=${encodeURIComponent(mail.token)}`);
}


async function patchSettings(client, patch) {
  const current = await client.request("/api/admin/settings");
  return client.request("/api/admin/settings", { method: "PATCH", json: { version: current.body?.data?.version, patch } });
}

const admin = makeClient();
const author = makeClient();
const other = makeClient();
const mod = makeClient();

await admin.request("/api/dev/reset", { method: "POST" });

const adminSignup = await signup(admin, "admin@example.test", "Admin", `adm${Date.now().toString(36)}`.slice(0, 18));
assert("admin signup", adminSignup.response.status === 200, adminSignup.response.body);
await verify(admin, "admin@example.test");
const config = await patchSettings(admin, {
    edit: { windowUserMinutes: 60, lockAfterReply: true, allowStaffEditOthers: true, historyVisibility: "author", requireReason: false, keepRevisions: 20 },
    security: { postMinIntervalSeconds: 0 },
    account: { registrationOpen: true },
  },);
assert("admin config patch", config.status === 200, config.body);
await new Promise((r) => setTimeout(r, 1200));

const authorEmail = `p3a-${Date.now()}@example.test`;
const authorName = `p3a${Date.now().toString(36)}`.slice(0, 18);
await signup(author, authorEmail, "P3 Author", authorName);
await verify(author, authorEmail);
const otherEmail = `p3b-${Date.now()}@example.test`;
await signup(other, otherEmail, "P3 Other", `p3b${Date.now().toString(36)}`.slice(0, 16));
await verify(other, otherEmail);
const modEmail = `p3m-${Date.now()}@example.test`;
await signup(mod, modEmail, "P3 Mod", `p3m${Date.now().toString(36)}`.slice(0, 16));
await verify(mod, modEmail);

// Insert a second category and make the moderator responsible for both.
{
  const handle = db();
  handle.exec("INSERT OR IGNORE INTO categories (id, slug, name, description, sort_order, is_visible, created_at) VALUES ('cat-chat', 'chat', '闲聊', '灌水与闲聊', 1, 1, unixepoch())");
  const modUser = handle.prepare("SELECT id FROM user WHERE email = ?").get(modEmail);
  handle.prepare("UPDATE user SET role = 'moderator' WHERE id = ?").run(modUser.id);
  handle.prepare("INSERT OR IGNORE INTO category_moderators (category_id, user_id) VALUES ('cat-general', ?), ('cat-chat', ?)").run(modUser.id, modUser.id);
  handle.close();
}
await mod.request("/api/auth/sign-out", { method: "POST" });
const modLogin = await mod.request("/api/auth/sign-in/email", { json: { email: modEmail, password: await derivePassword(modEmail, "correct horse battery staple") } });
assert("moderator login", modLogin.status === 200, modLogin.body);

const categories = await author.request("/api/categories");
const catGeneral = categories.body.data.find((c) => c.slug === "general");
const catChat = categories.body.data.find((c) => c.slug === "chat");
assert("second category exists", Boolean(catChat), categories.body);

const create = await author.request("/api/topics", {
  json: { categoryId: catGeneral.id, title: "P3 编辑主题", contentMd: "初始正文", tagIds: [] },
  headers: { "x-turnstile-token": TURNSTILE },
});
assert("topic create", create.status === 201, create.body);
const topicId = create.body.data.id;
let detail = await author.request(`/api/topics/${topicId}`);
const firstVersion = detail.body.data.firstPost.version;
assert("detail viewer can edit", detail.body.data.viewer.canEdit === true, detail.body.data.viewer);

const edit1 = await author.request(`/api/topics/${topicId}`, {
  method: "PATCH",
  json: { version: firstVersion, title: "P3 编辑主题（已编辑）", contentMd: "编辑后的正文" },
});
assert("author edits topic", edit1.status === 200 && edit1.body.data.version === firstVersion + 1, edit1.body);
const stale = await author.request(`/api/topics/${topicId}`, {
  method: "PATCH",
  json: { version: firstVersion, title: "stale", contentMd: "stale" },
});
assert("stale version returns 409", stale.status === 409 && stale.body.error.code === "version_conflict", stale.body);
const otherEdit = await other.request(`/api/topics/${topicId}`, {
  method: "PATCH",
  json: { version: firstVersion + 1, title: "hijack", contentMd: "hijack" },
});
assert("non-author edit forbidden", otherEdit.status === 403, otherEdit.body);

const history = await author.request(`/api/topics/${topicId}/revisions`);
assert("author sees revision history", history.status === 200 && history.body.data.some((r) => r.version === firstVersion), history.body);
const otherHistory = await other.request(`/api/topics/${topicId}/revisions`);
assert("other user cannot see author-only history", otherHistory.status === 403, otherHistory.body);

// Reply and lock-after-reply
const reply = await author.request(`/api/topics/${topicId}/posts`, {
  json: { contentMd: "回复正文" },
  headers: { "x-turnstile-token": TURNSTILE },
});
assert("reply create", reply.status === 201, reply.body);
const replyId = reply.body.data.id;
await new Promise((r) => setTimeout(r, 300));
detail = await author.request(`/api/topics/${topicId}`);
const lockedEdit = await author.request(`/api/topics/${topicId}`, {
  method: "PATCH",
  json: { version: detail.body.data.firstPost.version, contentMd: "locked edit" },
});
assert("lockAfterReply blocks first-post edit", lockedEdit.status === 403 && lockedEdit.body.error.code === "edit_locked", lockedEdit.body);

const replyEditNoReason = await author.request(`/api/posts/${replyId}`, {
  method: "PATCH",
  json: { version: 1, contentMd: "回复已编辑" },
});
assert("reply edit", replyEditNoReason.status === 200 && replyEditNoReason.body.data.version === 2, replyEditNoReason.body);
const adminEditOther = await admin.request(`/api/posts/${replyId}`, {
  method: "PATCH",
  json: { version: 2, contentMd: "管理员编辑" },
});
assert("admin edits others", adminEditOther.status === 200, adminEditOther.body);

// Moderator pin/lock/move
const pin = await mod.request(`/api/mod/topics/${topicId}/pin`, { method: "POST", json: { pinLevel: 1, pinOrder: 1 } });
assert("moderator category pin", pin.status === 200, pin.body);
const globalPin = await mod.request(`/api/mod/topics/${topicId}/pin`, { method: "POST", json: { pinLevel: 2 } });
assert("moderator cannot global pin", globalPin.status === 403, globalPin.body);
const lock = await mod.request(`/api/mod/topics/${topicId}/lock`, { method: "POST", json: { locked: true } });
assert("moderator locks topic", lock.status === 200, lock.body);
const move = await mod.request(`/api/mod/topics/${topicId}/move`, { method: "POST", json: { categoryId: catChat.id } });
assert("moderator moves between managed categories", move.status === 200, move.body);
const audit = await admin.request("/api/mod/audit");
assert("admin audit lists moderation actions", audit.status === 200 && audit.body.data.some((row) => row.action === "topic.move"), audit.body);

// Concurrent edits: one wins, one 409.
const unlocked = await mod.request(`/api/mod/topics/${topicId}/lock`, { method: "POST", json: { locked: false } });
assert("moderator unlocks topic", unlocked.status === 200, unlocked.body);
await new Promise((r) => setTimeout(r, 300));
detail = await author.request(`/api/topics/${topicId}`);
const version = detail.body.data.firstPost.version;
// first post is locked-after-reply, so use the reply (current version 3 after admin edit)
const replyCurrent = (await author.request(`/api/topics/${topicId}/posts`)).body.data.items.find((p) => p.id === replyId);
const [raceA, raceB] = await Promise.all([
  author.request(`/api/posts/${replyId}`, { method: "PATCH", json: { version: replyCurrent.version, contentMd: "race A" } }),
  author.request(`/api/posts/${replyId}`, { method: "PATCH", json: { version: replyCurrent.version, contentMd: "race B" } }),
]);
const winners = [raceA, raceB].filter((r) => r.status === 200).length;
const conflicts = [raceA, raceB].filter((r) => r.status === 409).length;
assert("concurrent edits: one success and one 409", winners === 1 && conflicts === 1, { a: raceA.status, b: raceB.status, version });


// requireReason + edit window expiry
const requireReason = await patchSettings(admin, { edit: { requireReason: true } });
assert("admin enables requireReason", requireReason.status === 200, requireReason.body);
const replyNow = (await author.request(`/api/topics/${topicId}/posts`)).body.data.items.find((p) => p.id === replyId);
const noReason = await author.request(`/api/posts/${replyId}`, { method: "PATCH", json: { version: replyNow.version, contentMd: "no reason" } });
assert("requireReason rejects missing reason", noReason.status === 400, noReason.body);
const withReason = await author.request(`/api/posts/${replyId}`, { method: "PATCH", json: { version: replyNow.version, contentMd: "with reason", reason: "补充说明" } });
assert("requireReason accepts reason", withReason.status === 200, withReason.body);

const windowConfig = await patchSettings(admin, { edit: { windowUserMinutes: 1 } });
assert("admin sets 1-minute edit window", windowConfig.status === 200, windowConfig.body);
const oldReply = await author.request(`/api/topics/${topicId}/posts`, {
  json: { contentMd: "将过期的回复" },
  headers: { "x-turnstile-token": TURNSTILE },
});
assert("old reply created", oldReply.status === 201, oldReply.body);
{
  const handle = db();
  handle.prepare("UPDATE posts SET created_at = ? WHERE id = ?").run(Math.floor(Date.now() / 1000) - 3600, oldReply.body.data.id);
  handle.close();
}
const expired = await author.request(`/api/posts/${oldReply.body.data.id}`, {
  method: "PATCH",
  json: { version: 1, contentMd: "expired edit", reason: "too late" },
});
assert("edit window expiry returns edit_window_expired", expired.status === 403 && expired.body.error.code === "edit_window_expired", expired.body);

await admin.request("/api/dev/reset", { method: "POST" });
const failed = results.filter((row) => !row.pass);
console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results }, null, 2));
if (failed.length) process.exitCode = 1;
