// P2 acceptance: categories, topics, replies, tags, likes, bookmarks, view,
// soft delete and user listing. Requires `pnpm dev` and applied migrations.
import { DatabaseSync } from "node:sqlite";
import { readdirSync } from "node:fs";
import { derivePassword } from "../packages/shared/src/config.ts";

const BASE = process.env.P2_BASE ?? "http://localhost:5173";
const DB_DIR = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";
const TURNSTILE = "XXXX.DUMMY.TOKEN.XXXX";
const results = [];
let cookie = "";
let lastCookie = null;

function assert(name, condition, detail) {
  results.push({ name, pass: Boolean(condition), detail });
  console.log(condition ? "PASS:" : "FAIL:", name, condition ? "" : JSON.stringify(detail ?? null).slice(0, 500));
}

function db() {
  const file = readdirSync(DB_DIR).find((name) => name.endsWith(".sqlite") && !name.startsWith("metadata"));
  if (!file) throw new Error("local D1 not found");
  return new DatabaseSync(`${DB_DIR}/${file}`);
}

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
    redirect: "manual",
  });
  for (const raw of response.headers.getSetCookie?.() ?? []) {
    const [pair, ...attrs] = raw.split(";");
    const [name, value] = pair.split("=");
    if (/max-age=0/i.test(raw) || !value) continue;
    cookie = `${name}=${value}`;
    lastCookie = { raw, name, value, attrs: attrs.map((a) => a.trim()) };
  }
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  return { status: response.status, body, headers: response.headers };
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

async function signup(email, name, username) {
  const password = await derivePassword(email, "correct horse battery staple");
  const response = await request("/api/auth/sign-up/email", {
    json: { email, password, name, username },
    headers: { "x-turnstile-token": TURNSTILE },
  });
  return { response, password };
}

async function verify(email) {
  const mail = await outbox(email, "verification");
  if (!mail) throw new Error(`no verification mail for ${email}`);
  return request(`/api/auth/verify-email?token=${encodeURIComponent(mail.token)}`);
}

await request("/api/dev/reset", { method: "POST" });
cookie = "";
lastCookie = null;

// Admin bootstrap + disable posting interval so reply can immediately follow.

async function patchSettings(patch) {
  const current = await request("/api/admin/settings");
  return request("/api/admin/settings", { method: "PATCH", json: { version: current.body?.data?.version, patch } });
}

const admin = await signup("admin@example.test", "Admin", `adm${Date.now().toString(36)}`.slice(0, 18));
assert("admin signup", admin.response.status === 200, admin.response.body);
await verify("admin@example.test");
const adminMe = await request("/api/me");
assert("admin promoted", adminMe.body?.data?.user?.role === "admin", adminMe.body);
const configPatch = await patchSettings({ security: { postMinIntervalSeconds: 0 }, account: { registrationOpen: true } },);
assert("admin disables post interval", configPatch.status === 200, configPatch.body);
await new Promise((r) => setTimeout(r, 5500));

const email = `p2-${Date.now()}@example.test`;
const username = `p2${Date.now().toString(36)}`.slice(0, 18);
const user = await signup(email, "P2 User", username);
assert("user signup", user.response.status === 200, user.response.body);
await verify(email);

const categories = await request("/api/categories");
assert("categories: default category exists", categories.body?.data?.some((c) => c.slug === "general"), categories.body);
const categoryId = categories.body.data[0].id;
const tags = await request("/api/tags");
assert("tags: defaults exist", tags.body?.data?.length >= 3, tags.body);
const tagIds = tags.body.data.slice(0, 2).map((tag) => tag.id);

const missingCaptcha = await request("/api/topics", {
  json: { categoryId, title: "无验证", contentMd: "正文", tagIds: [] },
});
assert("topic: missing Turnstile is rejected", missingCaptcha.status === 400 && missingCaptcha.body?.error?.code === "captcha_failed", missingCaptcha.body);

const create = await request("/api/topics", {
  json: { categoryId, title: "P2 测试主题", contentMd: "这是 **P2** 的正文。\n\n- 第一项\n- 第二项", tagIds },
  headers: { "x-turnstile-token": TURNSTILE },
});
assert("topic: create returns 201", create.status === 201 && create.body?.data?.id, create.body);
const topicId = create.body.data.id;

const detail = await request(`/api/topics/${topicId}`);
assert("topic: detail includes title/body/tags", detail.status === 200 && detail.body?.data?.topic?.title === "P2 测试主题" && detail.body?.data?.firstPost?.contentMd.includes("P2") && detail.body?.data?.topic?.tags?.length === 2, detail.body);
assert("topic: viewer can reply", detail.body?.data?.viewer?.canReply === true, detail.body?.data?.viewer);

const list = await request("/api/topics?sort=new");
assert("topics: list contains topic", list.status === 200 && list.body?.data?.items?.some((t) => t.id === topicId), list.body);

const reply = await request(`/api/topics/${topicId}/posts`, {
  json: { contentMd: "这是一条回复。" },
  headers: { "x-turnstile-token": TURNSTILE },
});
assert("reply: create returns floor 2", reply.status === 201 && reply.body?.data?.floor === 2, reply.body);
const replyId = reply.body.data.id;

const posts = await request(`/api/topics/${topicId}/posts?perPage=20`);
assert("posts: page 1 excludes first post", posts.status === 200 && posts.body?.data?.items?.length === 1 && posts.body.data.items[0].floor === 2, posts.body);
const detailAfterReply = await request(`/api/topics/${topicId}`);
assert("topic: reply_count increments", detailAfterReply.body?.data?.topic?.replyCount === 1, detailAfterReply.body?.data?.topic);

const like = await request(`/api/posts/${replyId}/like`, { method: "POST" });
assert("like: toggles on", like.status === 200 && like.body?.data?.liked === true && like.body.data.likeCount === 1, like.body);
const unlike = await request(`/api/posts/${replyId}/like`, { method: "POST" });
assert("like: toggles off", unlike.status === 200 && unlike.body?.data?.liked === false && unlike.body.data.likeCount === 0, unlike.body);

const bookmark = await request(`/api/topics/${topicId}/bookmark`, { method: "POST" });
assert("bookmark: toggles on", bookmark.status === 200 && bookmark.body?.data?.bookmarked === true, bookmark.body);
const bookmarks = await request("/api/me/bookmarks");
assert("bookmark: appears in my list", bookmarks.body?.data?.items?.some((t) => t.id === topicId), bookmarks.body);

const view = await request(`/api/topics/${topicId}/view`, { method: "POST" });
const detailView = await request(`/api/topics/${topicId}`);
assert("view: increments view_count", view.status === 200 && detailView.body?.data?.topic?.viewCount === 1, detailView.body?.data?.topic);

const profile = await request(`/api/users/${username}`);
assert("user: profile and counts", profile.status === 200 && profile.body?.data?.topicCount === 1 && profile.body?.data?.replyCount === 1, profile.body);
const userTopics = await request(`/api/users/${username}/topics`);
assert("user: topics page", userTopics.body?.data?.items?.some((t) => t.id === topicId), userTopics.body);
const userReplies = await request(`/api/users/${username}/replies`);
assert("user: replies page", userReplies.body?.data?.items?.some((p) => p.id === replyId), userReplies.body);

const deleteReply = await request(`/api/posts/${replyId}`, { method: "DELETE" });
assert("delete: reply soft deleted", deleteReply.status === 200, deleteReply.body);
const afterDelete = await request(`/api/topics/${topicId}`);
assert("delete: reply_count decrements", afterDelete.body?.data?.topic?.replyCount === 0, afterDelete.body?.data?.topic);

const deleteTopic = await request(`/api/topics/${topicId}`, { method: "DELETE" });
assert("delete: topic soft deleted", deleteTopic.status === 200, deleteTopic.body);
const gone = await request(`/api/topics/${topicId}`);
assert("delete: topic no longer readable", gone.status === 404, gone.body);

await request("/api/dev/reset", { method: "POST" });
const failed = results.filter((row) => !row.pass);
console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results }, null, 2));
if (failed.length) process.exitCode = 1;
