// P1 acceptance script. Requires `pnpm dev` and an applied local migration.
// It resets auth tables through the development-only /api/dev/reset endpoint,
// then exercises signup (Turnstile), verification, login, reset, admin
// bootstrap and config writes. Email is the development outbox in D1.
import { DatabaseSync } from "node:sqlite";
import { readdirSync } from "node:fs";
import { derivePassword } from "../packages/shared/src/config.ts";

const BASE = process.env.P1_BASE ?? "http://localhost:5173";
const DB_DIR = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";
const ADMIN_EMAIL = "admin@example.test";
const results = [];
let cookie = "";

function assert(name, condition, detail) {
  results.push({ name, pass: Boolean(condition), detail });
  if (!condition) console.log("FAIL:", name, JSON.stringify(detail).slice(0, 500));
  else console.log("PASS:", name);
}

function db() {
  const file = readdirSync(DB_DIR).find((name) => name.endsWith(".sqlite") && !name.startsWith("metadata"));
  if (!file) throw new Error("local D1 sqlite not found");
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
  const setCookie = response.headers.getSetCookie?.() ?? [];
  for (const raw of setCookie) {
    const [pair, ...attrs] = raw.split(";");
    const [name, value] = pair.split("=");
    if (/max-age=0/i.test(raw) || !value) continue;
    cookie = `${name}=${value}`;
    lastCookie = { raw, name, value, attrs: attrs.map((a) => a.trim()) };
  }
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  return { status: response.status, body, setCookie };
}

let lastCookie = null;

async function outbox(email, category) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const handle = db();
    const row = handle
      .prepare("SELECT payload_json FROM dev_email_outbox WHERE to_email = ? AND category = ? ORDER BY created_at DESC LIMIT 1")
      .get(email, category);
    handle.close();
    if (row) return JSON.parse(row.payload_json);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

async function signup(email, name, username) {
  const password = await derivePassword(email, "correct horse battery staple");
  const response = await request("/api/auth/sign-up/email", {
    json: { email, password, name, username },
    headers: { "x-turnstile-token": "XXXX.DUMMY.TOKEN.XXXX" },
  });
  return { response, password };
}

await request("/api/dev/reset", { method: "POST" });
cookie = "";
lastCookie = null;

// 1. Public config
const site = await request("/api/site");
assert("site: public config loads", site.status === 200 && site.body?.data?.feature?.turnstile === true, site.body);
assert("site: Turnstile test site key exposed", site.body?.data?.turnstileSiteKey?.startsWith("1x000"), site.body?.data?.turnstileSiteKey);

// 2. Turnstile gate
const emailA = `p1-a-${Date.now()}@example.test`;
const passwordA = await derivePassword(emailA, "correct horse battery staple");
const noCaptcha = await request("/api/auth/sign-up/email", {
  json: { email: emailA, password: passwordA, name: "P1 A", username: `a${Date.now().toString(36)}`.slice(0, 18) },
});
assert("signup: missing Turnstile token is captcha_failed", noCaptcha.status === 400 && noCaptcha.body?.error?.code === "captcha_failed", noCaptcha.body);

// 3. Signup with test token
const a = await signup(emailA, "P1 A", `a${Date.now().toString(36)}`.slice(0, 18));
assert("signup: test Turnstile token accepted", a.response.status === 200, a.response.body);
const cookieInfo = lastCookie;
assert(
  "cookie: host-only + HttpOnly + SameSite=Lax + 30d",
  cookieInfo && cookieInfo.attrs.some((x) => /HttpOnly/i.test(x)) && cookieInfo.attrs.some((x) => /SameSite=Lax/i.test(x)) && cookieInfo.attrs.some((x) => /Max-Age=2592000/i.test(x)) && !cookieInfo.attrs.some((x) => /Domain=/i.test(x)),
  cookieInfo,
);
assert("cookie: local development omits Secure", cookieInfo && !cookieInfo.attrs.some((x) => /Secure/i.test(x)), cookieInfo);

const meUnverified = await request("/api/me");
assert("me: new user is unverified and cannot write", meUnverified.status === 200 && meUnverified.body.data.user.emailVerified === false && meUnverified.body.data.permissions.canWrite === false, meUnverified.body);

// 4. Verify email
const verification = await outbox(emailA, "verification");
assert("email: verification outbox has token", Boolean(verification?.token), verification?.url);
const verify = await request(`/api/auth/verify-email?token=${encodeURIComponent(verification.token)}`);
const meVerified = await request("/api/me");
assert("verify: email becomes verified", verify.status === 200 && meVerified.body.data.user.emailVerified === true, meVerified.body);
assert("me: verified user can write", meVerified.body.data.permissions.canWrite === true, meVerified.body);

// 5. Login
const login = await request("/api/auth/sign-in/email", { json: { email: emailA, password: a.password } });
assert("login: derived password accepted", login.status === 200, login.body);
const badLogin = await request("/api/auth/sign-in/email", { json: { email: emailA, password: await derivePassword(emailA, "wrong password") } });
assert("login: wrong password rejected", badLogin.status === 401, badLogin.body);

// 6. Password reset
const resetCookie = cookie;
const resetRequest = await request("/api/auth/request-password-reset", { json: { email: emailA, redirectTo: "/reset-password" } });
const resetMail = await outbox(emailA, "reset");
assert("reset: request returns 200", resetRequest.status === 200, resetRequest.body);
assert("reset: email link includes token and email", Boolean(resetMail?.token) && resetMail?.url.includes("email="), resetMail?.url);
const rawReset = await request("/api/auth/reset-password", { json: { token: resetMail.token, newPassword: "raw-password" } });
assert("reset: raw password rejected", rawReset.status === 400 && rawReset.body?.error?.code === "validation_error", rawReset.body);
const newPassword = await derivePassword(emailA, "new correct horse battery staple");
const reset = await request("/api/auth/reset-password", { json: { token: resetMail.token, newPassword } });
assert("reset: derived password accepted", reset.status === 200, reset.body);
const oldCookieMe = await fetch(BASE + "/api/me", { headers: { origin: BASE, cookie: resetCookie } });
assert("reset: old session revoked", oldCookieMe.status === 401, oldCookieMe.status);
const oldLogin = await request("/api/auth/sign-in/email", { json: { email: emailA, password: a.password } });
assert("reset: old password rejected", oldLogin.status === 401, oldLogin.body);
const newLogin = await request("/api/auth/sign-in/email", { json: { email: emailA, password: newPassword } });
assert("reset: new password accepted", newLogin.status === 200, newLogin.body);

// 7. Admin bootstrap and settings
cookie = "";

async function patchSettings(patch) {
  const current = await request("/api/admin/settings");
  return request("/api/admin/settings", { method: "PATCH", json: { version: current.body?.data?.version, patch } });
}

const admin = await signup(ADMIN_EMAIL, "Admin", `admin${Date.now().toString(36)}`.slice(0, 14));
assert("admin: signup succeeds", admin.response.status === 200, admin.response.body);
const adminVerify = await outbox(ADMIN_EMAIL, "verification");
await request(`/api/auth/verify-email?token=${encodeURIComponent(adminVerify.token)}`);
const adminMe = await request("/api/me");
assert("admin: configured email promoted after verification", adminMe.body?.data?.user?.role === "admin", adminMe.body);
const adminSettings = await request("/api/admin/settings");
assert("admin: settings readable", adminSettings.status === 200 && adminSettings.body?.data?.config?.site, adminSettings.body);
const patch = await patchSettings({ site: { name: "P1 测试论坛" }, account: { registrationOpen: false } });
assert("admin: settings patch accepted", patch.status === 200 && Number(patch.body?.data?.version) >= 1, patch.body);
const publicAfter = await request("/api/site");
assert("config: public site reflects patch", publicAfter.body?.data?.site?.name === "P1 测试论坛" && publicAfter.body?.data?.account?.registrationOpen === false, publicAfter.body?.data);
// Security groups are cached per isolate for 5s by design.
await new Promise((resolve) => setTimeout(resolve, 5500));
const closedSignup = await signup(`p1-closed-${Date.now()}@example.test`, "Closed", `c${Date.now().toString(36)}`.slice(0, 18));
assert("config: registration closed blocks signup", closedSignup.response.status === 403, closedSignup.response.body);
await patchSettings({ site: { name: "我的论坛" }, account: { registrationOpen: true } });

// 8. Cleanup
await request("/api/dev/reset", { method: "POST" });
const failed = results.filter((row) => !row.pass);
console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results }, null, 2));
if (failed.length) process.exitCode = 1;
