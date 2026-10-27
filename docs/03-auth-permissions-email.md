# 03 Authentication, Permissions, Edit History, and Email

English | [简体中文](zh-CN/03-auth-permissions-email.md)

## Better Auth initialization

D1 bindings are request-scoped, so **do not create instances at module scope**. Call `createAuth(env, ctx)` for every request, or lazily initialize per isolate and pass `ExecutionContext` into hooks through a closure.

```ts
const auth = createAuth(env, c.executionCtx);
app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));
```

`baseURL = SITE_URL`, `trustedOrigins = [SITE_URL]`, `advanced.defaultCookieAttributes = { sameSite:'lax', secure:true, httpOnly:true, path:'/' }`. **Do not set `crossSubDomainCookies`.**

## Passwords: browser derivation + server-side HMAC

The free plan's 10ms CPU budget cannot run scrypt. Frontend:

```ts
const salt = new TextEncoder().encode(`forum:v1:${email.trim().toLowerCase()}`);
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
const bits = await crypto.subtle.deriveBits({ name:'PBKDF2', hash:'SHA-256', salt, iterations:310_000 }, key, 256);
const derived = 'v1$' + btoa(String.fromCharCode(...new Uint8Array(bits)));
```

Server-side `emailAndPassword.password`:

```ts
hash: (d) => hmacB64(env.PASSWORD_PEPPER, d),
verify: async ({ hash, password }) => timingSafeEqual(hash, await hmacB64(env.PASSWORD_PEPPER, password)),
```

P1 implementation (2026-10-22): `TURNSTILE_SITE_KEY` is a public identifier; the test keys are `1x00000000000000000000AA`/`1x0000000000000000000000000000000AA` and only live in the local `.dev.vars`; production no longer commits test keys, which are instead configured in the admin console at `/admin/integrations` or as Worker variables. Admin-console values take precedence over environment variables; when `ENVIRONMENT=development` locally the cookie omits `Secure` (localhost has no HTTPS), while staging/production force `Secure`. Turnstile only reaches siteverify after payload validation, the registration switch, and per-IP rate limiting.

Key points:
- The "Account & data" page offers a password change: current password plus the new password twice; on success the current session is kept and all other sessions are revoked.
- All four forms — signup/login/password change/reset — derive first; the email is the salt, so **v1 forbids changing the email by default** (the config option has been removed). If this is enabled later, the email-change flow must also force a password reset.
- The server validates the format `^v1\$[A-Za-z0-9+/=]{43,}$` to prevent submitting the raw weak password while bypassing the frontend.
- `PASSWORD_PEPPER` can be rotated incrementally: after a successful login verified with the old pepper, recompute the hash with the new one from the same derived value and overwrite it, with no need for everyone to reset.
- Online brute force is not protected by the KDF: login must use `rateLimit.storage='database'`, and Turnstile is added after repeated failures.
- Password strength can only be checked in the browser.

## Signup, verification, reset

1. Signup: Turnstile → `signUpEmail` (pass the derived value as the password) → `requireEmailVerification=false` → login is allowed but write operations are intercepted by middleware.
2. Verification email: `waitUntil` inside the hook, with the link pointing at a **frontend page** `/verify-email?token=`; the verify API is only called after the user clicks the "Confirm verification" button, so mail scanners cannot prefetch and consume the token.
3. Reset: `forget-password` returns 200 whether or not the email exists; mail is only sent via `waitUntil` when it does, eliminating the timing side channel. Tokens last 30 minutes and are single-use. On success all sessions for that user are revoked (`revokeSessionsOnPasswordReset: true` plus manually deleting session rows), and that user's unsubscribe token version is bumped.
4. Resend has click/open tracking disabled, otherwise links get rewritten and prefetched.

## OAuth and same-email merging (not enabled in v1, reserved for v1.1)

**Decided: v1 only supports email + password login.** Google / GitHub keep only their config options, the database `account` table fields, and the frontend button positions; `socialProviders` gets no client id/secret and the OAuth routes are not exposed. v1 does not implement same-email merging, and there is no attack surface for "an unverified local account being taken over by OAuth". When it is enabled, still follow the design below.

`accountLinking: { enabled:true, trustedProviders:['google','github'], allowDifferentEmails:false }`.

```
provider email verified
├─ no account with the same email → create user, auto-generate a unique username
├─ local account verified → link account, write audit_logs('account.link')
├─ local account unverified → link + delete credential account + revoke all sessions
│                    + audit_logs('account.link.unverified_guard')
└─ different email → conflict, prompt to log in the original way first and then link
```

The third branch is a required security patch: otherwise an attacker can register the victim's email first (login works even without verification), and when the victim later logs in via OAuth they get merged automatically while the attacker's password remains valid.

> **Spike findings (2026-10-22)**: Better Auth 1.7.12 adds `accountLinking.requireLocalEmailVerified`, defaulting to `true`. By default it rejects the merge on an unverified local account with `account_not_linked` (no credential deletion, no session revocation); only explicitly setting it to `false` takes the third branch above. The spike verified that `databaseHooks.account.create.before` can delete the credential and revoke sessions before the merge. Because v1 does not enable OAuth yet, the policy here is deferred to v1.1; at that point, first evaluate keeping the library default rejection and adding "verify/reset first" UX.

## Roles and permissions

- `user`: default.
- `moderator`: `role='moderator'` and a row in `category_moderators`; permissions are limited to the moderated categories. Assigning a moderator in the admin console automatically promotes a regular user; removing the last category mapping automatically falls back to `user`. The admin user management page can change roles and ban/unban; you cannot act on yourself, and you cannot demote or ban the last active admin. The account-deletion grace period is not automatically cancelled by arbitrary requests — it requires an explicit `POST /api/me/delete/cancel`.
- `admin`: site-wide; the last admin cannot be deleted or demoted.

| Action | user | moderator | admin |
|---|---|---|---|
| Browse/search | ✓ | ✓ | ✓ |
| Create topic/reply | Verified + registration open | ✓ | ✓ |
| Edit own | Per the user window | Per the moderator window | Per the admin window |
| Edit others | ✗ | Subject to `allowStaffEditOthers` | ✓ |
| Delete own | Subject to `allowSelfDelete` | ✓ | ✓ |
| Delete others/pin/lock/move | ✗ | Moderated categories | Site-wide |
| Moderation/report handling | ✗ | Moderated categories | Site-wide |
| Config/users/tags | ✗ | ✗ | ✓ |

Edit decision order: allow admin → allow moderator in a moderated category when editing others is permitted → author subject to the role window → reject if `lockAfterReply` and the first post already has replies → otherwise reject. A value of `0` minutes means permanent. Authors cannot edit content that is not `published`; only admins can restore it.

## Edit history (single batch + CAS)

P3 has implemented snapshots + CAS + revision history; FTS dual writes are added to the same batch in P5 once the tables exist.

All write statements carry the same `version` guard; when the version does not match the whole batch is a no-op, and `meta.changes` is used to decide 409:

```ts
const [, , , upd] = await env.DB.batch([
  // 1 Snapshot the old content
  db.prepare(`INSERT INTO post_revisions (id,topic_id,post_id,version,title,content_md,action,editor_id,reason,created_at)
              SELECT ?, p.topic_id, p.id, p.version, p.title, p.content_md, 'edit', ?, ?, ?
              FROM posts p WHERE p.id=? AND p.version=?`).bind(...),
  // 2 Invalidate the old search entry
  db.prepare(`DELETE FROM post_search WHERE post_uid=? AND EXISTS
              (SELECT 1 FROM posts WHERE id=? AND version=?)`).bind(...),
  // 3 Write the new search entry
  db.prepare(`INSERT INTO post_search (post_uid,topic_id,title,tokens)
              SELECT ?, topic_id, ?, ? FROM posts WHERE id=? AND version=?`).bind(...),
  // 4 CAS update the main table
  db.prepare(`UPDATE posts SET title=COALESCE(?,title), content_md=?, content_text=?,
                version=version+1, edit_count=edit_count+1, edited_at=?, updated_at=?
              WHERE id=? AND version=?`).bind(...),
]);
if (upd.meta.changes === 0) return err('version_conflict', 409);
```

- The title is only stored on the first post, so topic edits and reply edits share a single path.
- The most recent N versions are kept (20 by default), pruned at the end of the same batch or by a daily cleanup.
- Deletion writes an `action='delete'` snapshot; restoration writes `restore`.
- History visibility: `public` / `author` / `staff`; admins always see everything.

## Notifications and email

In-site notifications are always written; email goes through a separate channel:

| Category | Channel |
|---|---|
| Verification, reset | `waitUntil` direct send |
| @mentions, admin actions | `waitUntil` direct send (max 5 people per post) |
| Topic receives a reply, reply receives a reply | `notifications` table + Cron digest every 5 minutes |

P4 implementation: in-site notifications/preferences/unsubscribe/digests are in place; without a Resend key, mail goes to a dev outbox; @mentions are sent directly through `waitUntil` and generate unsubscribe tokens.

Digest job: take 20 users with pending mail → take at most 50 rows per user with an atomic claim (`email_batch_key=claim:<ts>:<id>`, ≤ 100 parameters) → filter by global switch/user preference/unsubscribe/verified/account status → fetch the daily budget in one query → merge into one email (max 10 rows) → write `email_logs(queued)` first, then call Resend (8s timeout, retry 5xx once) → update statuses in bulk with one UPDATE. Each user has its own try/catch; when the budget is insufficient, release and defer instead of marking skipped; unprocessed claims are reclaimed by the 5-minute job.

User default preferences: all in-site notifications on; email `mention=on`, `topicReply=on`, `postReply=on`, `moderation=on` and cannot be turned off.

Unsubscribe: one 32-byte random token per category, stored as SHA-256, 180-day expiry, and incrementing `version` invalidates old links. The `GET /unsubscribe?token=` link at the bottom of emails only shows a confirmation page; it only takes effect via `POST /api/unsubscribe`. Both `List-Unsubscribe` and `List-Unsubscribe-Post: One-Click` are supported.

Resend allows 100 emails/day and 1 domain on the free plan. Wire up the `email.bounced` / `complained` webhooks (Svix verification), and stop sending and mark the address once hit; sends carry an `Idempotency-Key`; `dailyBudget` defaults to 80 to leave headroom.

## Account deletion implementation (P5)

`POST /api/me/delete` verifies the derived password, then sets `status` to `deleting`, writes `deletedAt`, and deletes all sessions; logging in during the grace period does not restore the account automatically — it requires an explicit `POST /api/me/delete/cancel`. A daily Cron anonymizes nickname/email/avatar/bio after `deletionGraceDays` while keeping topics and replies; the cleanup job can also be triggered manually by an admin. Export is done through `POST /api/me/export`, which returns a JSON attachment.

## First administrator

The `ADMIN_EMAILS` environment variable; when a user matches it on first verification/login they are promoted to `admin` and an audit entry is written. For day-to-day grants use `pnpm admin:grant <email>`.
