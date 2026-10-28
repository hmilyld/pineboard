import { DatabaseSync } from "node:sqlite";
import { readdirSync } from "node:fs";
import { derivePassword } from "../packages/shared/src/config.ts";

const BASE = process.env.P4_BASE ?? "http://localhost:5173";
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
    // Editing is a write path guarded by Turnstile, exactly like creating.
    if (options.method === "PATCH") headers.set("x-turnstile-token", TURNSTILE);
    const response = await fetch(BASE + path, {
      method: options.method ?? (options.json !== undefined ? "POST" : "GET"),
      headers,
      body: options.json !== undefined ? JSON.stringify(options.json) : options.text,
    });
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";");
      const [name, value] = pair.split("=");
      if (value && !/max-age=0/i.test(raw)) cookie = `${name}=${value}`;
    }
    const text = await response.text();
    let body;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
    return { status: response.status, body };
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
  if (!mail) throw new Error(`no verification mail for ${email}`);
  return client.request(`/api/auth/verify-email?token=${encodeURIComponent(mail.token)}`);
}
async function digest(admin) {
  return admin.request("/api/admin/emails/digest", { method: "POST" });
}


async function patchSettings(client, patch) {
  const current = await client.request("/api/admin/settings");
  return client.request("/api/admin/settings", { method: "PATCH", json: { version: current.body?.data?.version, patch } });
}

const admin = makeClient();
const author = makeClient();
const replier = makeClient();
const mentioned = makeClient();
await admin.request("/api/dev/reset", { method: "POST" });

await signup(admin, "admin@example.test", "Admin", `adm${Date.now().toString(36)}`.slice(0, 18));
await verify(admin, "admin@example.test");
const config = await patchSettings(admin, {
    mail: { enabled: true, digestWindowMinutes: 5, userDailyCap: 10, dailyBudget: 80 },
    security: { postMinIntervalSeconds: 0 },
    account: { registrationOpen: true },
  },);
assert("admin mail config", config.status === 200, config.body);

const authorEmail = `p4a-${Date.now()}@example.test`;
const authorName = `p4a${Date.now().toString(36)}`.slice(0, 18);
await signup(author, authorEmail, "P4 Author", authorName);
await verify(author, authorEmail);
const replierEmail = `p4b-${Date.now()}@example.test`;
const replierName = `p4b${Date.now().toString(36)}`.slice(0, 18);
await signup(replier, replierEmail, "P4 Replier", replierName);
await verify(replier, replierEmail);
const mentionedEmail = `p4c-${Date.now()}@example.test`;
await signup(mentioned, mentionedEmail, "P4 Mentioned", `p4c${Date.now().toString(36)}`.slice(0, 16));
await verify(mentioned, mentionedEmail);

const categories = await author.request("/api/categories");
const topic = await author.request("/api/topics", {
  json: { categoryId: categories.body.data[0].id, title: "P4 通知主题", contentMd: "欢迎回复", tagIds: [] },
  headers: { "x-turnstile-token": TURNSTILE },
});
assert("topic created", topic.status === 201, topic.body);
const topicId = topic.body.data.id;

const reply = await replier.request(`/api/topics/${topicId}/posts`, {
  json: { contentMd: "谢谢分享" },
  headers: { "x-turnstile-token": TURNSTILE },
});
assert("reply created", reply.status === 201, reply.body);
const replyId = reply.body.data.id;

// Mention notification via a second reply.
const mentionedMe = await mentioned.request("/api/me");
const mentionUsername = mentionedMe.body.data.user.username;
const mentionReply = await replier.request(`/api/topics/${topicId}/posts`, {
  json: { contentMd: `请 @${mentionUsername} 看看` },
  headers: { "x-turnstile-token": TURNSTILE },
});
assert("mention reply created", mentionReply.status === 201, mentionReply.body);

const authorNotifications = await author.request("/api/me/notifications");
assert("author receives topic_reply", authorNotifications.body.data.items.some((n) => n.type === "topic_reply"), authorNotifications.body);
assert("unread count", authorNotifications.body.data.unread >= 1, authorNotifications.body.data.unread);
const mentionNotifications = await mentioned.request("/api/me/notifications");
assert("mentioned user receives mention", mentionNotifications.body.data.items.some((n) => n.type === "mention"), mentionNotifications.body);
const mentionMail = await outbox(mentionedEmail, "mention", 5000);
assert("mention email is delivered directly", Boolean(mentionMail?.subject?.includes("提到了你")), mentionMail?.subject);
const markRead = await author.request("/api/me/notifications/read", { method: "POST", json: { all: true } });
const afterRead = await author.request("/api/me/notifications");
assert("mark all read", markRead.status === 200 && afterRead.body.data.unread === 0, afterRead.body);

const prefs = await author.request("/api/me/preferences");
assert("preferences defaults", prefs.body.data.email.topic_reply === true && prefs.body.data.email.post_reply === false && prefs.body.data.email.moderation === true, prefs.body);
const prefPatch = await author.request("/api/me/preferences", { method: "PATCH", json: { email: { post_reply: true, moderation: false } } });
assert("preferences patch forces moderation on", prefPatch.body.data.email.post_reply === true && prefPatch.body.data.email.moderation === true, prefPatch.body);

const beforeDigest = await outbox(authorEmail, "digest", 10);
const digestResult = await digest(admin);
assert("digest runs", digestResult.status === 200, digestResult.body);
await new Promise((r) => setTimeout(r, 300));
const digestMail = await outbox(authorEmail, "digest");
assert("digest email written to dev outbox", Boolean(digestMail?.subject?.includes("新通知")), digestMail?.subject);
assert("digest email has unsubscribe link", Boolean(digestMail?.text?.includes("/unsubscribe?token=")), digestMail?.text?.slice(0, 300));

const token = digestMail.text.match(/\/unsubscribe\?token=([A-Za-z0-9_-]+)/)?.[1];
assert("unsubscribe token extracted", Boolean(token), token);
const preview = await author.request(`/api/unsubscribe/preview?token=${encodeURIComponent(token)}`);
assert("unsubscribe preview is read-only", preview.status === 200 && preview.body.data.valid === true, preview.body);
const unsubscribe = await author.request("/api/unsubscribe", { method: "POST", json: { token } });
assert("unsubscribe applies", unsubscribe.status === 200, unsubscribe.body);
const afterUnsubPrefs = await author.request("/api/me/preferences");
assert("unsubscribe disables category", afterUnsubPrefs.body.data.email.topic_reply === false, afterUnsubPrefs.body);
const reused = await author.request(`/api/unsubscribe/preview?token=${encodeURIComponent(token)}`);
assert("unsubscribe token is single-use", reused.status === 404, reused.body);

// Resend bounce webhook in development (no webhook secret).
const bounce = await admin.request("/api/webhooks/resend", {
  json: { type: "email.bounced", data: { to: [authorEmail] } },
});
assert("resend bounce webhook accepted", bounce.status === 200, bounce.body);
{
  const handle = db();
  const row = handle.prepare("SELECT reason FROM email_suppressions WHERE email = ?").get(authorEmail);
  handle.close();
  assert("bounce creates suppression", Boolean(row), row);
}
const logs = await admin.request("/api/admin/emails");
assert("admin email logs", logs.status === 200 && logs.body.data.length > 0, logs.body);

await admin.request("/api/dev/reset", { method: "POST" });
const failed = results.filter((row) => !row.pass);
console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results }, null, 2));
if (failed.length) process.exitCode = 1;
