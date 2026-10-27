# 08 Configuration and deployment entry points

English | [简体中文](zh-CN/08-configuration.md)

> For creating Cloudflare resources from scratch, initializing an administrator, backups/rollback and open-source cleanup, see the [09 Deployment Guide](09-deployment.md). This document covers only the runtime configuration inventory and its precedence.

This document is the single inventory of runtime configuration. Principles:

1. **Hard dependencies required to start the system live in Cloudflare Worker variables/Secrets**, never in the database.
2. **Integration credentials that can be rotated operationally belong in the database first** (`/admin/integrations`, AES-GCM encrypted); when they are not configured in CF, a database value must exist.
3. **Site business configuration lives in D1 `settings`**, validated per group with Zod, and database values override `DEFAULTS`.
4. Each piece of configuration keeps exactly one primary entry point; environment variables are only a runtime fallback and are not duplicated anywhere outside this document.

## 1. Configuration sources and precedence

| Source | Content | Entry point |
|---|---|---|
| `wrangler.jsonc` `vars` | Public Worker variables fixed at deploy time | Repository configuration, deployed with the code |
| Cloudflare Worker Secrets | Startup-critical secrets, authentication/encryption root keys | `wrangler secret put` or the Cloudflare Dashboard |
| D1 `settings` | Site, SEO, account, mail, feature flags, upload, security, theme, non-secret integration values | `/admin/settings`, `/admin/integrations` |
| D1 `settings` (`secrets.*`) | Resend/Turnstile/R2 encrypted secrets | `/admin/integrations` |
| GitHub Environment `production` Secrets | CI deployment credentials only | GitHub Actions |

Override order:

```text
secrets.* (DB)                 > RESEND_API_KEY / TURNSTILE_SECRET / R2_* (Worker Secrets)
integration.cloudflare.* (DB)  > R2_ACCOUNT_ID / R2_BUCKET_NAME / CDN_URL / TURNSTILE_SITE_KEY (Worker vars/secrets)
settings.* (DB)                > DEFAULTS
```

`SITE_URL`, `ENVIRONMENT`, `BETTER_AUTH_SECRET`, `PASSWORD_PEPPER`, `IP_HASH_SALT`, `ADMIN_EMAILS`, `EMAIL_TRANSPORT` and `DEV_RESET_TOKEN` **are read from the Worker environment only and are never stored in the database**. The OAuth variables are currently disabled and have been removed from `.dev.vars.example`.

## 2. Required (the system is unusable without them)

These must be configured before deploying the Cloudflare Worker and cannot live in the database alone:

| Name | Type | Description |
|---|---|---|
| `DB` | D1 binding | `wrangler.jsonc`, the main database |
| `BUCKET` | R2 binding | `wrangler.jsonc`, uploaded object storage |
| `ASSETS` | Assets binding | `wrangler.jsonc`, the front-end static build |
| `CF_VERSION_METADATA` | binding | `wrangler.jsonc`, version for the health check |
| `SITE_URL` | Worker var | For example `https://forum.example.com`; Better Auth baseURL, authentication requests misbehave without it |
| `ENVIRONMENT` | Worker var | Must be `production` in production; local `.dev.vars` overrides it to `development` |
| `BETTER_AUTH_SECRET` | Worker secret | Better Auth signing key, also derives the integration secret encryption key; rotating it makes stored integration ciphertexts unreadable |
| `PASSWORD_PEPPER` | Worker secret | HMAC pepper applied after the browser-side PBKDF2 derivation; the password chain is insecure without it |
| `IP_HASH_SALT` | Worker secret | IP hash salt; rate limiting/audit privacy weaken without it |

Before a tag deployment the deploy workflow runs:

```bash
wrangler secret list --format json > /tmp/worker-secrets.json
node scripts/check-worker-secrets.mjs /tmp/worker-secrets.json
```

If any of the three required Secrets is missing it fails immediately and nothing is deployed.

## 3. Feature-critical (missing values only affect that feature)

| Feature | CF variable/Secret | Database counterpart | Behavior when missing |
|---|---|---|---|
| Upload/R2 | `R2_BUCKET_NAME`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | `integration.cloudflare.r2Bucket/accountId`, `secrets.r2AccessKeyId/r2SecretAccessKey` | `sign` returns "upload service not configured"; Worker direct upload still works as a temporary fallback |
| CDN | `CDN_URL` | `integration.cloudflare.cdnUrl` | Fall back to local `/files/*` |
| Turnstile | `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET` | `integration.cloudflare.turnstileSiteKey`, `secrets.turnstileSecret` | Without a Site Key both front end and back end treat it as disabled; with only a Site Key and no Secret it returns `captcha_unavailable` |
| Mail/Resend | `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` | `secrets.resendApiKey/resendWebhookSecret` | Mail is marked `skipped` and not sent; production never writes the dev outbox |
| Administrator bootstrap | `ADMIN_EMAILS` | none | Optional; administrators can also be controlled purely by the database role |
| Mail transport | `EMAIL_TRANSPORT` | none | Omitted in production; locally set `log` to write `dev_email_outbox` |
| Local test reset | `DEV_RESET_TOKEN` | none | Local only; even when set in production the endpoint returns 404 because `ENVIRONMENT` is not development |

> "If it is not configured in the CF environment variables, it must be configured in the database" applies to the integration items in the table above. For production we recommend putting the Resend/Turnstile/R2 secrets in the database so they are easy to rotate, and putting `SITE_URL`, `ENVIRONMENT` and the three authentication root keys in CF.

## 4. Admin UI coverage

The following configuration groups can currently still only be maintained through D1 `settings`/migrations or the code defaults, because the admin settings page does not yet provide a complete form (to avoid exposing unvalidated editors to administrators):

- `edit.*`
- `security.*`
- `upload.*`
- `theme.*`
- advanced `mail` items such as budget, digest window and TLL
- detailed `feature` items such as search/reports/guest read

Site, SEO, the basic account items, maintenance mode, pagination, the Turnstile upload switch and integration secrets already have UI. If these groups need to be operated from the admin panel, add the UI and matching e2e coverage first instead of editing production D1 by hand.

## 5. D1 `settings` groups

| Group | Main keys | Defaults/notes |
|---|---|---|
| `site` | name, tagline, url, description, keywords, logoKey, faviconKey, ogImageKey, timezone, language, icp, announcement | Default name **Pineboard**; `site.url` should match `SITE_URL`; `language` (`zh-CN` or `en`) is the one UI language used by the public site and the admin console. Only interface copy, error codes, dates and server-rendered SEO phrases are translated; user content and operator copy are never translated |
| `seo` | titleTemplate, homeTitle, description, noindex, topicsPerPage, postsPerPage, sitemapEnabled | Pagination 5–50 |
| `account` | registrationOpen, allowUnverifiedLogin, requireVerificationForWrite, passwordMinLength, usernameMin/Max, sessionDays, deletionGraceDays | Registration/verification/account deletion policy |
| `edit` | windowUserMinutes, windowModeratorMinutes, allowStaffEditOthers, lockAfterReply, allowSelfDelete, historyVisibility, keepRevisions, requireReason | Edit window and edit history |
| `mail` | enabled, fromName, fromAddress, replyTo, notify*, dailyBudget, userDailyCap, digestWindowMinutes, verificationTtlMinutes, resetTtlMinutes, unsubscribeTokenDays | Digest and mail budget |
| `feature` | turnstile, pwa, markdown, search, uploads, reports, guestRead | Feature flags |
| `maintenance` | enabled, message, allowAdmin | Maintenance mode; `message` is shown verbatim |
| `upload` | imageMaxMb, fileMaxMb, userDailyCount, orphanTtlHours | The type whitelist is fixed in code |
| `security` | postMinIntervalSeconds, newUserDailyPosts, mentionMaxPerPost, reportDailyLimit, signupPerHour | Rate limits |
| `integration` | cloudflare.accountId/r2Bucket/cdnUrl/turnstileSiteKey | Falls back to CF when missing |
| `theme` | layout, tokens, darkMode | Theme tokens |
| `secrets` | resendApiKey, resendWebhookSecret, turnstileSecret, r2AccessKeyId, r2SecretAccessKey | AES-GCM ciphertext, never echoed back |

## 6. Deployment entry points

### Ordinary pushes

```bash
git push origin main
```

Only triggers **CI** (typecheck, unit tests, build, deploy environment check) and does not deploy to Cloudflare.

### Version releases

Production deployment is triggered only after an explicit tag:

```bash
git tag v0.2.4
git push origin v0.2.4
```

The `Deploy` workflow runs only for `v*` tags (or a manual `workflow_dispatch`):

1. `pnpm db:migrate:remote`
2. `pnpm typecheck` + `pnpm test`
3. Validate the required Worker Secrets
4. `pnpm build`
5. `wrangler deploy --var ENVIRONMENT:production`
6. `https://forum.example.com/api/health` smoke test

### Production initialization order (summary)

```bash
pnpm db:migrate:remote

# Required Secrets (once only, reset only on a later rotation)
pnpm exec wrangler secret put BETTER_AUTH_SECRET
pnpm exec wrangler secret put PASSWORD_PEPPER
pnpm exec wrangler secret put IP_HASH_SALT

# Optional: first-time administrator bootstrap
pnpm exec wrangler secret put ADMIN_EMAILS

# Release
git tag v0.2.4 && git push origin v0.2.4
```

See the [09 Deployment Guide](09-deployment.md) for the full steps. After deploying, configure Resend/Turnstile/R2 at `/admin/integrations` or provide them as CF variables; confirm:

```bash
curl -s https://forum.example.com/api/health
# turnstileConfigured=true  (when Turnstile is enabled)
```

## 7. GitHub Environment Secrets

The `production` environment only needs deployment credentials:

| Secret | Purpose |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Wrangler calls to the Cloudflare API |
| `CLOUDFLARE_ACCOUNT_ID` | Selects the account |

These are not application runtime variables and never reach the Worker; the required runtime secrets still have to be configured in Worker Secrets.
