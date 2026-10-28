// Moderation acceptance: edit Turnstile gate, sensitive-word review queue, and
// the approve/reject transitions. Requires `pnpm dev` and applied migrations.
import { DatabaseSync } from "node:sqlite";
import { readdirSync } from "node:fs";
import { derivePassword } from "../packages/shared/src/config.ts";

const BASE = process.env.P2_BASE ?? "http://localhost:5173";
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

function client() {
  let cookie = "";
  return {
    get cookie() { return cookie; },
    async request(path, options = {}) {
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
        void attrs;
      }
      const text = await response.text();
      let body;
      try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
      return { status: response.status, body };
    },
  };
}

async function outbox(email, category, timeout = 4000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const handle = db();
    const row = handle.prepare("SELECT payload_json FROM dev_email_outbox WHERE to_email = ? AND category = ? ORDER BY created_at DESC LIMIT 1").get(email, category);
    handle.close();
    if (row) return JSON.parse(row.payload_json);
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

async function signUpAndVerify(email) {
  const c = client();
  const password = await derivePassword("Str0ng-Pass-1492!", email);
  const signup = await c.request("/api/auth/sign-up/email", {
    json: { email, password, name: email.split("@")[0], username: email.split("@")[0].slice(0, 18).replace(/[^a-z0-9]/g, "") },
    headers: { "x-turnstile-token": TURNSTILE },
  });
  if (signup.status !== 200) throw new Error(`signup failed: ${JSON.stringify(signup.body).slice(0, 300)}`);
  const mail = await outbox(email, "verification");
  if (!mail?.token) throw new Error(`no verification mail for ${email}`);
  const verified = await c.request(`/api/auth/verify-email?token=${encodeURIComponent(mail.token)}`);
  if (verified.status !== 200) throw new Error(`verify failed: ${JSON.stringify(verified.body).slice(0, 300)}`);
  return c;
}

/** Admin role must be granted out of band; retry while D1 is busy. */
async function makeAdmin(email) {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const handle = db();
      handle.prepare('UPDATE "user" SET role = \'admin\' WHERE email = ?').run(email);
      handle.close();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  throw new Error("could not promote admin: database stayed locked");
}

async function patchSettings(c, patch) {
  const current = await c.request("/api/admin/settings");
  return c.request("/api/admin/settings", {
    method: "PATCH",
    json: { version: current.body?.data?.version, patch },
  });
}

const stamp = Date.now();
const author = await signUpAndVerify(`rev-author-${stamp}@example.test`);

const adminEmail = `rev-admin-${stamp}@example.test`;
const admin = await signUpAndVerify(adminEmail);
await makeAdmin(adminEmail);
// The session middleware reads the role per request, so the next call sees it.
const adminCheck = await admin.request("/api/me");
assert("setup: admin session has admin role", adminCheck.body?.data?.permissions?.isAdmin === true, adminCheck.body);

// --- Configure a dictionary that is easy to trip on purpose -----------------
const words = ["代开发票", "网络赌博"];
const saved = await patchSettings(admin, { security: { sensitiveWords: words, sensitiveWordsEnabled: true } });
assert("words: dictionary saved", saved.status === 200, saved.body);

const cats = await admin.request("/api/categories");
const categoryId = cats.body?.data?.[0]?.id;
assert("setup: category available", Boolean(categoryId), cats.body);

// --- 1. Edit without a Turnstile token is rejected --------------------------
const clean = await author.request("/api/topics", {
  json: { categoryId, title: "正常主题标题", contentMd: "这是一段完全正常的内容。", tagIds: [] },
  headers: { "x-turnstile-token": TURNSTILE },
});
assert("edit-gate: clean topic published immediately", clean.status === 201 && !clean.body?.data?.pending, clean.body);
const cleanId = clean.body?.data?.id;

const noTokenEdit = await author.request(`/api/topics/${cleanId}`, {
  method: "PATCH",
  json: { version: 1, title: "改了标题", contentMd: "改过的内容", reason: "补充" },
});
assert("edit-gate: PATCH without token is captcha_failed", noTokenEdit.status === 400 && noTokenEdit.body?.error?.code === "captcha_failed", noTokenEdit.body);

const withTokenEdit = await author.request(`/api/topics/${cleanId}`, {
  method: "PATCH",
  json: { version: 1, title: "正常主题标题 v2", contentMd: "改过的正常内容", reason: "补充" },
  headers: { "x-turnstile-token": TURNSTILE },
});
assert("edit-gate: PATCH with token succeeds", withTokenEdit.status === 200, withTokenEdit.body);

// --- 2. Editing clean text into flagged text diverts the topic --------------
const dirtyEdit = await author.request(`/api/topics/${cleanId}`, {
  method: "PATCH",
  json: { version: 2, contentMd: "现在改成代开发票的广告内容", reason: "偷偷改" },
  headers: { "x-turnstile-token": TURNSTILE },
});
assert("edit-gate: editing into a keyword diverts to review", dirtyEdit.status === 200 && dirtyEdit.body?.data?.pending === true, dirtyEdit.body);

const hidden = await author.request(`/api/topics/${cleanId}`);
assert("edit-gate: diverted topic is not publicly readable", hidden.status === 404, hidden.body);

// --- 3. Flagged topic create lands in the queue -----------------------------
const flaggedTopic = await author.request("/api/topics", {
  json: { categoryId, title: "低价代开发票 全网最低", contentMd: "有需要的联系我", tagIds: [] },
  headers: { "x-turnstile-token": TURNSTILE },
});
assert("queue: flagged topic is pending", flaggedTopic.status === 201 && flaggedTopic.body?.data?.pending === true, flaggedTopic.body);
const flaggedTopicId = flaggedTopic.body?.data?.id;

const queue = await admin.request("/api/mod/pending");
const queueIds = (queue.body?.data?.items ?? []).map((item) => item.id);
assert("queue: pending list includes the flagged topic", queueIds.includes(flaggedTopicId), queue.body);
const queueItem = (queue.body?.data?.items ?? []).find((item) => item.id === flaggedTopicId);
assert("queue: pending item carries matched keywords", Array.isArray(queueItem?.keywords) && queueItem.keywords.includes("代开发票"), queueItem);

// --- 4. Flagged reply does not bump counters --------------------------------
const normalTopic = await author.request("/api/topics", {
  json: { categoryId, title: "另一个正常主题", contentMd: "正常正文内容。", tagIds: [] },
  headers: { "x-turnstile-token": TURNSTILE },
});
const normalId = normalTopic.body?.data?.id;
const before = await author.request(`/api/topics/${normalId}`);

const flaggedReply = await author.request(`/api/topics/${normalId}/posts`, {
  json: { contentMd: "这里可以玩网络赌博哦" },
  headers: { "x-turnstile-token": TURNSTILE },
});
assert("reply: flagged reply is pending", flaggedReply.status === 201 && flaggedReply.body?.data?.pending === true, flaggedReply.body);
const after = await author.request(`/api/topics/${normalId}`);
assert("reply: pending reply does not change reply_count", before.body?.data?.topic?.replyCount === after.body?.data?.topic?.replyCount, { before: before.body?.data?.topic?.replyCount, after: after.body?.data?.topic?.replyCount });

const posts = await author.request(`/api/topics/${normalId}/posts?page=1`);
const visibleContents = (posts.body?.data?.items ?? []).map((p) => p.contentMd);
assert("reply: pending reply is not listed", !visibleContents.some((t) => t.includes("网络赌博")), visibleContents);

// --- 5. Approve the flagged topic ------------------------------------------
const approve = await admin.request(`/api/mod/topics/${flaggedTopicId}/review`, { json: { action: "approve" } });
assert("review: approve succeeds", approve.status === 200 && approve.body?.data?.status === "published", approve.body);
const nowVisible = await author.request(`/api/topics/${flaggedTopicId}`);
assert("review: approved topic becomes readable", nowVisible.status === 200, nowVisible.status);
const afterApprove = await admin.request("/api/mod/pending");
assert("review: approved topic leaves the queue", !(afterApprove.body?.data?.items ?? []).some((i) => i.id === flaggedTopicId), afterApprove.body);

// --- 6. Reject the flagged reply -------------------------------------------
const pendingReplyId = (await admin.request("/api/mod/pending")).body?.data?.items?.find((i) => i.kind === "post")?.id;
const reject = await admin.request(`/api/mod/posts/${pendingReplyId}/review`, { json: { action: "reject", reason: "违规" } });
assert("review: reject succeeds", reject.status === 200 && reject.body?.data?.status === "rejected", reject.body);
const notRestored = await admin.request(`/api/topics/${normalId}/posts?page=1`);
assert("review: rejected reply stays hidden", !(notRestored.body?.data?.items ?? []).some((p) => p.contentMd.includes("网络赌博")), notRestored.body);

// --- 7. Non-moderators cannot use the queue --------------------------------
const stranger = await signUpAndVerify(`rev-stranger-${stamp}@example.test`);
const forbidden = await stranger.request("/api/mod/pending");
assert("authz: ordinary user cannot read the queue", forbidden.status === 403 || forbidden.status === 401, forbidden.status);
const strangerApprove = await stranger.request(`/api/mod/topics/${cleanId}/review`, { json: { action: "approve" } });
assert("authz: ordinary user cannot approve", strangerApprove.status === 403 || strangerApprove.status === 401, strangerApprove.status);

// --- 8. Disabling screening restores direct publishing ---------------------
await patchSettings(admin, { security: { sensitiveWordsEnabled: false } });
const direct = await author.request("/api/topics", {
  json: { categoryId, title: "禁用检测后仍可发代开发票", contentMd: "内容", tagIds: [] },
  headers: { "x-turnstile-token": TURNSTILE },
});
assert("toggle: disabling screening publishes directly", direct.status === 201 && !direct.body?.data?.pending, direct.body);
await patchSettings(admin, { security: { sensitiveWordsEnabled: true } });

// --- 9. Empty dictionary never diverts ------------------------------------
await patchSettings(admin, { security: { sensitiveWords: [] } });
const emptyDict = await author.request("/api/topics", {
  json: { categoryId, title: "空词库代开发票", contentMd: "内容", tagIds: [] },
  headers: { "x-turnstile-token": TURNSTILE },
});
assert("toggle: empty dictionary publishes directly", emptyDict.status === 201 && !emptyDict.body?.data?.pending, emptyDict.body);
await patchSettings(admin, { security: { sensitiveWords: words } });

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log(JSON.stringify(failed, null, 2));
  process.exit(1);
}
