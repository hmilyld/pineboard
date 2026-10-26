import { DatabaseSync } from "node:sqlite";
import { readdirSync } from "node:fs";
import { derivePassword } from "../packages/shared/src/config.ts";

const BASE = process.env.V2_BASE ?? "http://localhost:5173";
const DB_DIR = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";
const TURNSTILE = "XXXX.DUMMY.TOKEN.XXXX";
const results = [];
function assert(name, condition, detail) {
  results.push({ name, pass: Boolean(condition), detail });
  console.log(condition ? "PASS:" : "FAIL:", name, condition ? "" : JSON.stringify(detail ?? null).slice(0, 500));
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
    await new Promise((r) => setTimeout(r, 40));
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


async function patchSettings(client, patch) {
  const current = await client.request("/api/admin/settings");
  return client.request("/api/admin/settings", { method: "PATCH", json: { version: current.body?.data?.version, patch } });
}

const admin = makeClient();
const author = makeClient();
const replier = makeClient();
await admin.request("/api/dev/reset", { method: "POST" });
await signup(admin, "admin@example.test", "V2 Admin", `v2adm${Date.now().toString(36)}`.slice(0, 18));
await verify(admin, "admin@example.test");
await patchSettings(admin, {
    security: { postMinIntervalSeconds: 0 },
    account: { registrationOpen: true },
    site: { announcement: { id: "v2-test", enabled: true, text: "V2 公告", href: "/tags" } },
  },);

const suffix = Date.now().toString(36);
const authorEmail = `v2a-${suffix}@example.test`;
const authorName = `v2a${suffix}`.slice(0, 18);
await signup(author, authorEmail, "V2 Author", authorName);
await verify(author, authorEmail);
const replierEmail = `v2b-${suffix}@example.test`;
const replierName = `v2b${suffix}`.slice(0, 18);
await signup(replier, replierEmail, "V2 Replier", replierName);
await verify(replier, replierEmail);

const categories = await author.request("/api/categories");
const tools = categories.body.data.find((item) => item.slug === "tools") ?? categories.body.data[0];
assert("categories: stats and recent topic", typeof tools.stats?.topics === "number" && "recentTopic" in tools, tools);
const site = await author.request("/api/site");
assert("site: announcement public", site.body.data.site.announcement.enabled === true && site.body.data.site.announcement.text === "V2 公告", site.body.data.site.announcement);
const stats = await author.request("/api/site/stats");
assert("site: stats fields", ["todayPosts", "topics", "replies", "members"].every((key) => typeof stats.body.data[key] === "number"), stats.body);

const topic = await author.request("/api/topics", {
  json: { categoryId: tools.id, title: "V2 主题", contentMd: "V2 主题正文，支持中文搜索。", tagIds: [] },
  headers: { "x-turnstile-token": TURNSTILE },
});
assert("topic: create", topic.status === 201, topic.body);
const topicId = topic.body.data.id;
const reply = await replier.request(`/api/topics/${topicId}/posts`, {
  json: { contentMd: "V2 回复正文" },
  headers: { "x-turnstile-token": TURNSTILE },
});
assert("reply: create", reply.status === 201 && reply.body.data.floor === 2, reply.body);

const page1 = await author.request(`/api/topics/${topicId}/posts?page=1`);
assert("posts: page 1 excludes first post", page1.status === 200 && page1.body.data.items.length === 1 && page1.body.data.items[0].floor === 2, page1.body);
assert("posts: page metadata", page1.body.data.total === 2 && page1.body.data.totalPages === 1 && page1.body.data.onlyOp === false, page1.body.data);
const onlyOp = await author.request(`/api/topics/${topicId}/posts?page=1&onlyOp=1`);
assert("posts: onlyOp excludes non-OP replies", onlyOp.body.data.items.length === 0 && onlyOp.body.data.onlyOp === true, onlyOp.body.data);
const notification = await author.request("/api/me/notifications");
const replyNotification = notification.body.data.items.find((item) => item.type === "topic_reply");
assert("notifications: postFloor", replyNotification?.postFloor === 2, notification.body);

const digest = await admin.request(`/api/mod/topics/${topicId}/digest`, { method: "POST", json: { isDigest: true } });
assert("digest: set", digest.status === 200 && digest.body.data.isDigest === true, digest.body);
const digestList = await author.request("/api/topics?digest=1");
assert("digest: filter", digestList.body.data.items.some((item) => item.id === topicId && item.isDigest === true), digestList.body);
const tagList = await author.request("/api/tags");
const tag = tagList.body.data.find((item) => item.topicCount > 0) ?? tagList.body.data[0];
const tagDetail = tag ? await author.request(`/api/tags/${tag.slug}`) : null;
assert("tags: detail stats", Boolean(tagDetail && tagDetail.body.data.stats && typeof tagDetail.body.data.stats.replies === "number"), tagDetail?.body);

const reindex = await admin.request("/api/admin/search/reindex", { method: "POST" });
assert("search: reindex", reindex.status === 200, reindex.body);
const searchLatest = await author.request(`/api/search?q=${encodeURIComponent("V2 主题")}&sort=latest`);
assert("search: latest sorted result", searchLatest.status === 200 && searchLatest.body.data.sort === "latest" && searchLatest.body.data.items.length >= 1, searchLatest.body);
const searchRelevance = await author.request(`/api/search?q=${encodeURIComponent("V2 主题")}&sort=relevance`);
assert("search: relevance result", searchRelevance.body.data.sort === "relevance" && searchRelevance.body.data.items.length >= 1, searchRelevance.body);


const adminCategories = await admin.request("/api/admin/categories");
assert("admin: categories list has color", adminCategories.status === 200 && adminCategories.body.data.every((item) => /^#[0-9a-f]{6}$/i.test(item.color)), adminCategories.body);
const createdCategory = await admin.request("/api/admin/categories", {
  json: { slug: `v2cat-${suffix}`, name: "V2 临时版块", description: "e2e", color: "#123456", sortOrder: 999, isVisible: true },
});
assert("admin: category create", createdCategory.status === 201 && createdCategory.body.data.color === "#123456", createdCategory.body);
const updatedCategory = await admin.request(`/api/admin/categories/${createdCategory.body.data.id}`, {
  method: "PATCH",
  json: { slug: `v2cat-${suffix}`, name: "V2 临时版块 2", description: "e2e", color: "#654321", sortOrder: 999, isVisible: false },
});
assert("admin: category update", updatedCategory.status === 200 && updatedCategory.body.data.isVisible === false, updatedCategory.body);
const deletedCategory = await admin.request(`/api/admin/categories/${createdCategory.body.data.id}`, { method: "DELETE" });
assert("admin: category delete", deletedCategory.status === 200 && deletedCategory.body.data.deleted === true, deletedCategory.body);

const adminNav = await admin.request("/api/admin/nav");
assert("admin: nav list", adminNav.status === 200 && adminNav.body.data.some((item) => item.kind === "categories"), adminNav.body);
const createdNav = await admin.request("/api/admin/nav", {
  json: { label: "V2 链接", href: "/tags", kind: "link", sortOrder: 999, isVisible: true, openInNewTab: false },
});
assert("admin: nav create", createdNav.status === 201, createdNav.body);
const publicNav = await author.request("/api/nav");
assert("nav: public visible item", publicNav.status === 200 && publicNav.body.data.some((item) => item.id === createdNav.body.data.id), publicNav.body);
const updatedNav = await admin.request(`/api/admin/nav/${createdNav.body.data.id}`, {
  method: "PATCH",
  json: { label: "V2 链接 2", href: "/search", kind: "link", sortOrder: 999, isVisible: false, openInNewTab: true },
});
assert("admin: nav update", updatedNav.status === 200 && updatedNav.body.data.isVisible === false, updatedNav.body);
const deletedNav = await admin.request(`/api/admin/nav/${createdNav.body.data.id}`, { method: "DELETE" });
assert("admin: nav delete", deletedNav.status === 200, deletedNav.body);

const dropdown = await admin.request("/api/admin/nav", {
  json: { label: "V2 下拉", href: "", kind: "dropdown", sortOrder: 998, isVisible: true, openInNewTab: false },
});
const child = await admin.request("/api/admin/nav", {
  json: { label: "V2 子项", href: "/tags", kind: "link", parentId: dropdown.body.data.id, sortOrder: 1, isVisible: true, openInNewTab: false },
});
assert("admin: nav dropdown + child", dropdown.status === 201 && child.status === 201, { dropdown: dropdown.body, child: child.body });
const tree = await author.request("/api/nav");
const treeItem = tree.body.data.find((item) => item.id === dropdown.body.data.id);
assert("nav: dropdown tree", treeItem?.children?.some((item) => item.id === child.body.data.id), tree.body);
const hideParent = await admin.request(`/api/admin/nav/${dropdown.body.data.id}`, {
  method: "PATCH",
  json: { label: "V2 下拉", href: "", kind: "dropdown", parentId: null, sortOrder: 998, isVisible: false, openInNewTab: false },
});
const hiddenTree = await author.request("/api/nav");
assert("nav: hidden parent hides children", hideParent.status === 200 && !hiddenTree.body.data.some((item) => item.id === dropdown.body.data.id), hiddenTree.body);
await admin.request(`/api/admin/nav/${dropdown.body.data.id}`, { method: "DELETE" });

const adminMe = await admin.request("/api/me");
const userList = await admin.request("/api/admin/users?page=1");
assert("admin: users list", userList.status === 200 && userList.body.data.items.some((item) => item.id === adminMe.body.data.user.id), userList.body);
const selfRole = await admin.request(`/api/admin/users/${adminMe.body.data.user.id}`, { method: "PATCH", json: { role: "user" } });
assert("admin: cannot change own role", selfRole.status === 403, selfRole.body);

const integrations = await admin.request("/api/admin/integrations");
assert("admin: integrations shape", integrations.status === 200 && integrations.body.data.secrets.turnstileSecret.source !== undefined, integrations.body);
const integrationPatch = await admin.request("/api/admin/integrations", {
  method: "PATCH",
  json: {
    version: Number(integrations.body.data.version),
    integration: { cloudflare: { turnstileSiteKey: "1x00000000000000000000AA" } },
    secrets: { resendApiKey: "re_v2_e2e_placeholder" },
  },
});
assert("admin: secret stored encrypted", integrationPatch.status === 200 && integrationPatch.body.data.secrets.resendApiKey.source === "database", integrationPatch.body);
const siteWithKey = await admin.request("/api/site");
assert("site: admin turnstile site key", siteWithKey.body.data.turnstileSiteKey === "1x00000000000000000000AA", siteWithKey.body.data.turnstileSiteKey);
const integrationAfter = await admin.request("/api/admin/integrations");
const integrationClear = await admin.request("/api/admin/integrations", {
  method: "PATCH",
  json: {
    version: Number(integrationAfter.body.data.version),
    integration: { cloudflare: { turnstileSiteKey: "" } },
    secrets: { resendApiKey: null },
  },
});
assert("admin: secret clear", integrationClear.status === 200 && integrationClear.body.data.secrets.resendApiKey.configured === false, integrationClear.body);

const overview = await admin.request("/api/admin/overview");
assert("admin: overview", overview.status === 200 && overview.body.data.configVersion && "pendingReportItems" in overview.body.data, overview.body);
assert("admin: overview jobs object", typeof overview.body.data.jobs === "object", overview.body.data.jobs);

await admin.request("/api/dev/reset", { method: "POST" });
const failed = results.filter((row) => !row.pass);
console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results }, null, 2));
if (failed.length) process.exitCode = 1;
