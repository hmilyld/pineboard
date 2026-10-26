import {
  BASE,
  assert,
  derivePassword,
  inspect,
  json,
  makeClient,
  parseToken,
  reset,
  saveResults,
  trace,
  waitForOutbox,
} from "./lib.mjs";

const results = [];
const evidence = {};

function oauthCode(email) {
  return "spike:" + Buffer.from(email).toString("base64url");
}

async function oauth(client, email, headers = {}) {
  const social = await client.request("/api/auth/sign-in/social", {
    json: { provider: "test-oauth", callbackURL: "/spike/oauth/done", disableRedirect: true },
    headers,
  });
  const socialBody = await json(social);
  if (!socialBody.url) return { social, socialBody, callback: null };
  const state = new URL(socialBody.url).searchParams.get("state");
  const callback = await client.request(
    `/api/auth/callback/test-oauth?code=${encodeURIComponent(oauthCode(email))}&state=${encodeURIComponent(state)}`,
    { headers },
  );
  return { social, socialBody, callback };
}

function cookieAttributes(setCookie) {
  return {
    httpOnly: /HttpOnly/i.test(setCookie),
    secure: /Secure/i.test(setCookie),
    sameSiteLax: /SameSite=Lax/i.test(setCookie),
    hasDomain: /Domain=/i.test(setCookie),
    path: /Path=\//i.test(setCookie),
  };
}

// --- Flow A: signup + waitUntil verification email -------------------------------
await reset();
const aliceEmail = "alice.spike@example.test";
const alicePassword = await derivePassword(aliceEmail, "correct horse battery staple");
const alice = makeClient();
const signupStart = performance.now();
const signup = await alice.request("/api/auth/sign-up/email", {
  json: { email: aliceEmail, password: alicePassword, name: "Alice" },
});
const signupWall = performance.now() - signupStart;
const signupBody = await json(signup);
const signupSetCookie = signup.headers.getSetCookie?.()[0] ?? "";
const signupTrace = await trace();
let state = await inspect();

evidence.signup = {
  status: signup.status,
  wallMs: Number(signupWall.toFixed(2)),
  serverWallMs: signup.headers.get("x-spike-wall-ms"),
  setCookie: signupSetCookie.replace(/=.*?;/, "=<redacted>;"),
  userId: state.users[0]?.id,
  storedHashLength: state.accounts[0]?.password_length ?? null,
  transactions: signupTrace.transactionStatements,
  statements: signupTrace.statementsSeen,
};

assert(results, "signup: 200", signup.status === 200, signupBody);
assert(results, "signup: no interactive transaction", signupTrace.hasInteractiveTransaction === false, signupTrace.transactionStatements);
assert(results, "signup: user + credential account + session", state.users.length === 1 && state.accounts.length === 1 && state.sessions.length === 1, state);
assert(results, "signup: email starts unverified", state.users[0]?.email_verified === 0, state.users[0]);
assert(results, "signup: rateLimit written to D1", state.rateLimits.length >= 1, state.rateLimits);
assert(results, "signup: password stored as HMAC, not derived value", state.accounts[0]?.has_password === 1, state.accounts[0]);

const cookieAttrs = cookieAttributes(signupSetCookie);
evidence.signup.cookie = cookieAttrs;
assert(
  results,
  "cookie: host-only + HttpOnly + Secure + SameSite=Lax + Path=/",
  cookieAttrs.httpOnly && cookieAttrs.secure && cookieAttrs.sameSiteLax && !cookieAttrs.hasDomain && cookieAttrs.path,
  cookieAttrs,
);

const outboxAtResponse = (await inspect()).outbox.some((row) => row.kind === "verify");
const verifyEntry = await waitForOutbox("verify");
evidence.signup.waitUntil = {
  outboxKind: verifyEntry?.kind ?? null,
  outboxAtResponse,
  responseWallMs: Number(signupWall.toFixed(2)),
};
assert(results, "signup: verification email deferred via waitUntil", Boolean(verifyEntry), verifyEntry);
assert(results, "signup: email work not awaited before the response", !outboxAtResponse, evidence.signup.waitUntil);

// --- Flow B: verify email --------------------------------------------------------
const verifyToken = parseToken(verifyEntry);
const verify = await alice.request(`/api/auth/verify-email?token=${encodeURIComponent(verifyToken)}`);
state = await inspect();
evidence.verify = { status: verify.status, verified: state.users[0]?.email_verified };
assert(results, "verify-email: user becomes verified", verify.status === 200 && state.users[0]?.email_verified === 1, evidence.verify);

// --- Flow C: sign-in -------------------------------------------------------------
const signin = await alice.request("/api/auth/sign-in/email", {
  json: { email: aliceEmail, password: alicePassword },
});
const signinTrace = await trace();
evidence.signin = { status: signin.status, transactions: signinTrace.transactionStatements, serverWallMs: signin.headers.get("x-spike-wall-ms") };
assert(results, "sign-in: 200 with derived password", signin.status === 200, await json(signin));
assert(results, "sign-in: no interactive transaction", signinTrace.hasInteractiveTransaction === false, signinTrace.transactionStatements);

// --- Flow D: OAuth merge into verified local account -----------------------------
const mergeClient = makeClient();
const merge = await oauth(mergeClient, aliceEmail);
state = await inspect();
const mergeTrace = await trace();
evidence.oauthVerifiedMerge = {
  callbackStatus: merge.callback?.status,
  location: merge.callback?.headers.get("location"),
  users: state.users.length,
  accounts: state.accounts.map((a) => a.provider_id),
  audit: state.outbox.filter((o) => o.kind === "account.link").map((o) => JSON.parse(o.payload)),
  transactions: mergeTrace.transactionStatements,
};
assert(results, "oauth merge (verified local): account linked", merge.callback?.status === 302 && state.accounts.length === 2, evidence.oauthVerifiedMerge);
assert(results, "oauth merge (verified local): audit row written", state.outbox.some((o) => o.kind === "account.link"), evidence.oauthVerifiedMerge.audit);
assert(results, "oauth merge (verified local): no interactive transaction", mergeTrace.hasInteractiveTransaction === false, mergeTrace.transactionStatements);

// --- Flow E: OAuth merge into unverified local account (default gate) ------------
await reset();
const carolEmail = "carol.spike@example.test";
const carolPassword = await derivePassword(carolEmail, "carol password is long enough");
const carol = makeClient();
await carol.request("/api/auth/sign-up/email", { json: { email: carolEmail, password: carolPassword, name: "Carol" } });
const defaultGate = await oauth(carol, carolEmail);
state = await inspect();
const defaultGateTrace = await trace();
evidence.oauthUnverifiedDefault = {
  callbackStatus: defaultGate.callback?.status,
  location: defaultGate.callback?.headers.get("location"),
  accounts: state.accounts.map((a) => a.provider_id),
  users: state.users.length,
  transactions: defaultGateTrace.transactionStatements,
};
assert(
  results,
  "oauth merge (unverified local, requireLocalEmailVerified=true): refused with account_not_linked",
  defaultGate.callback?.status === 302 && /account_not_linked/.test(defaultGate.callback?.headers.get("location") ?? ""),
  evidence.oauthUnverifiedDefault,
);
assert(results, "oauth merge (unverified local, default): credential account preserved", state.accounts.length === 1 && state.accounts[0].provider_id === "credential", state.accounts);

// --- Flow F: requireLocalEmailVerified=false without guard (unsafe evidence) -----
await reset();
const daveEmail = "dave.spike@example.test";
const davePassword = await derivePassword(daveEmail, "dave password is long enough");
const dave = makeClient();
await dave.request("/api/auth/sign-up/email", { json: { email: daveEmail, password: davePassword, name: "Dave" } });
const unsafe = await oauth(dave, daveEmail, { "x-spike-require-verified": "0" });
state = await inspect();
evidence.oauthUnverifiedUnguarded = {
  callbackStatus: unsafe.callback?.status,
  accounts: state.accounts.map((a) => a.provider_id),
  emailVerified: state.users[0]?.email_verified,
  sessions: state.sessions.length,
};
assert(
  results,
  "oauth merge (unverified local, gate disabled): links and leaves attacker credential (documents why guard is required)",
  unsafe.callback?.status === 302 && state.accounts.some((a) => a.provider_id === "credential") && state.accounts.some((a) => a.provider_id === "test-oauth"),
  evidence.oauthUnverifiedUnguarded,
);

// --- Flow G: docs/03 guard implemented via account.create.before ----------------
await reset();
const erinEmail = "erin.spike@example.test";
const erinPassword = await derivePassword(erinEmail, "erin password is long enough");
const erin = makeClient();
await erin.request("/api/auth/sign-up/email", { json: { email: erinEmail, password: erinPassword, name: "Erin" } });
const attackerCookie = erin.jar.header();
const guarded = await oauth(erin, erinEmail, { "x-spike-require-verified": "0", "x-spike-guard": "1" });
state = await inspect();
const guardedTrace = await trace();
const oldSession = await fetch(BASE + "/api/auth/get-session", { headers: { cookie: attackerCookie } });
evidence.oauthUnverifiedGuarded = {
  callbackStatus: guarded.callback?.status,
  accounts: state.accounts.map((a) => a.provider_id),
  sessions: state.sessions.length,
  guardAudit: state.outbox.filter((o) => o.kind === "account.link.unverified_guard").length,
  attackerSessionStatus: oldSession.status,
  attackerSessionBody: (await oldSession.text()).slice(0, 80),
  transactions: guardedTrace.transactionStatements,
};
assert(
  results,
  "guard: credential account deleted on unverified link",
  guarded.callback?.status === 302 && !state.accounts.some((a) => a.provider_id === "credential"),
  evidence.oauthUnverifiedGuarded,
);
assert(results, "guard: old sessions revoked", state.sessions.length <= 1, evidence.oauthUnverifiedGuarded);
assert(results, "guard: audit row written", state.outbox.some((o) => o.kind === "account.link.unverified_guard"), evidence.oauthUnverifiedGuarded);
assert(results, "guard: no interactive transaction", guardedTrace.hasInteractiveTransaction === false, guardedTrace.transactionStatements);

// --- Flow H: password reset + session revocation ---------------------------------
await reset();
const frankEmail = "frank.spike@example.test";
const oldPassword = await derivePassword(frankEmail, "old password is long enough");
const newPassword = await derivePassword(frankEmail, "new password is long enough");
const frank = makeClient();
await frank.request("/api/auth/sign-up/email", { json: { email: frankEmail, password: oldPassword, name: "Frank" } });
const verifyFrank = await waitForOutbox("verify");
await frank.request(`/api/auth/verify-email?token=${encodeURIComponent(parseToken(verifyFrank))}`);
await frank.request("/api/auth/sign-in/email", { json: { email: frankEmail, password: oldPassword } });
await frank.request("/api/auth/sign-in/email", { json: { email: frankEmail, password: oldPassword } });
const sessionsBefore = (await inspect()).sessions.length;
const forgot = await frank.request("/api/auth/request-password-reset", { json: { email: frankEmail, redirectTo: "/reset-password" } });
const forgotTrace = await trace();
const resetEntry = await waitForOutbox("reset");
const resetCall = await frank.request("/api/auth/reset-password", {
  json: { token: parseToken(resetEntry), newPassword },
});
const resetTrace = await trace();
state = await inspect();
await fetch(BASE + "/spike/ratelimit/clear", { method: "POST" });
const oldLogin = await makeClient().request("/api/auth/sign-in/email", { json: { email: frankEmail, password: oldPassword } });
await fetch(BASE + "/spike/ratelimit/clear", { method: "POST" });
const newLogin = await makeClient().request("/api/auth/sign-in/email", { json: { email: frankEmail, password: newPassword } });
evidence.passwordReset = {
  sessionsBefore,
  forgotStatus: forgot.status,
  forgotResponse: await json(forgot),
  resetStatus: resetCall.status,
  sessionsAfter: state.sessions.length,
  oldLoginStatus: oldLogin.status,
  newLoginStatus: newLogin.status,
  forgotTransactions: forgotTrace.transactionStatements,
  resetTransactions: resetTrace.transactionStatements,
};
assert(results, "reset: request-password-reset always 200", forgot.status === 200, evidence.passwordReset);
assert(results, "reset: token consumed and password changed", resetCall.status === 200 && newLogin.status === 200, evidence.passwordReset);
assert(results, "reset: all sessions revoked", state.sessions.length === 0, evidence.passwordReset);
assert(results, "reset: old password rejected", oldLogin.status === 401, evidence.passwordReset);
assert(results, "reset: no interactive transaction", resetTrace.hasInteractiveTransaction === false, resetTrace.transactionStatements);

// --- Flow I: forcing transaction:true breaks signup ------------------------------
await reset();
const txEmail = "tx.spike@example.test";
const txPassword = await derivePassword(txEmail, "tx password is long enough");
const txClient = makeClient();
const txSignup = await txClient.request("/api/auth/sign-up/email", {
  json: { email: txEmail, password: txPassword, name: "Tx" },
  headers: { "x-spike-tx": "1" },
});
const txTrace = await trace();
state = await inspect();
evidence.transactionForced = {
  status: txSignup.status,
  body: await json(txSignup),
  transactionStatements: txTrace.transactionStatements,
  errors: txTrace.errors,
  usersWritten: state.users.length,
};
assert(
  results,
  "transaction:true: fails at BEGIN with D1 error",
  txSignup.status === 500 && txTrace.hasInteractiveTransaction && txTrace.errors.some((e) => /BEGIN TRANSACTION|transaction/i.test(e)),
  evidence.transactionForced,
);
assert(results, "transaction:true: no partial user row", state.users.length === 0, state.users);

// --- Flow J: change-email stays disabled by default ------------------------------
await reset();
const graceEmail = "grace.spike@example.test";
const gracePassword = await derivePassword(graceEmail, "grace password is long enough");
const grace = makeClient();
await grace.request("/api/auth/sign-up/email", { json: { email: graceEmail, password: gracePassword, name: "Grace" } });
const changeEmail = await grace.request("/api/auth/change-email", { json: { newEmail: "other@example.test" } });
evidence.changeEmail = { status: changeEmail.status, body: await json(changeEmail) };
assert(results, "change-email: disabled by default (salt = email)", changeEmail.status !== 200, evidence.changeEmail);

const failed = results.filter((row) => !row.pass);
console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results, evidence }, null, 2));
saveResults("spike2.json", { passed: results.length - failed.length, failed: failed.length, results, evidence });
if (failed.length > 0) process.exitCode = 1;
