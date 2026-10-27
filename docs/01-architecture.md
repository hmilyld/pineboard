# 01 Architecture

English | [简体中文](zh-CN/01-architecture.md)

## Deployment shape

A single Worker + Workers Static Assets, deployed same-origin:

```
Browser
  │ https://forum.example.com
Cloudflare Edge
  ├─ /assets/*, images and other static files ──→ Static Assets (CDN, requests are free and do not count against Worker quota)
  ├─ /api/*                    ──→ Worker (Hono)
  ├─ /t/* /c/* /u/* /tag/*     ──→ Worker: ASSETS.fetch(index.html) + HTMLRewriter meta injection
  ├─ /sitemap.xml /robots.txt /manifest.webmanifest ──→ generated dynamically by the Worker
  ├─ D1: forum, Better Auth, settings, FTS5, logs
  ├─ R2: public bucket (cdn.example.com); presigned direct upload
  ├─ Resend / Turnstile        ──→ outbound HTTPS
  └─ Cron: email digest */5, cleanup and reconciliation daily
```

Worker configuration highlights: `assets.directory = "./apps/web/dist/client"` (Vite client output), `not_found_handling = "single-page-application"`, `run_worker_first = ["/", "/api/*", "/files/*", "/t/*", "/c/*", "/u/*", "/tag/*", "/sitemap.xml", "/robots.txt", "/manifest.webmanifest"]`.

> At P0 only `/api/*` is enabled; otherwise the not-yet-implemented document routes such as `/t/*` would be caught by an empty Worker and break SPA fallback. Add the remaining paths in one go at P6 when meta injection is implemented.

## Request flow

**Read topic (anonymous)**: Worker → config (45s cache) → optional authentication → 2 D1 queries (topic + first post + tags; replies paginated) → JSON. Document navigation additionally injects meta, and `caches.default` caches for 300s.

**Create post**: authentication → email verified → write rate limit → payload validation → Turnstile → single D1 batch (insert post, topic counters/lastPostAt, FTS, mentions, notifications, audit) → 201. Emails are not awaited.

**Register/reset**: Turnstile (registration) → Better Auth → `waitUntil` sends the email inside the hook → respond immediately.

**Document request**: `/`, `/t/:id`, `/c/:slug`, `/tag/:slug`, `/u/:username` → fetch meta (cached) → `ASSETS.fetch('/index.html')` → HTMLRewriter rewrites title/description/og/canonical/robots, injects JSON-LD; missing content returns a 404/410 status code but still renders the SPA shell.

## Directory structure

```
forum.example.com/
├─ apps/api/          # Hono routes, services, Better Auth, Drizzle
├─ apps/web/          # Vue3 + Vite + Tailwind v4 + shadcn-vue
├─ packages/shared/   # Zod contracts, error codes, config defaults, permission enums
├─ packages/db/       # schema, drizzle-kit, migrations
├─ docs/
└─ wrangler.jsonc     # root-level deployment config (assets points to apps/web/dist)
```

## Bindings and environment variables

> For the full configuration list, precedence and tag deployment flow, see `docs/08-configuration.md`.

| Name | Type | Description |
|---|---|---|
| `DB` | D1 | Primary database |
| `BUCKET` | R2 | Avatars/attachments/site images |
| `ASSETS` | Static Assets | Frontend build output |
| `SITE_URL` | var | `https://forum.example.com` |
| `CDN_URL` | var | `https://cdn.example.com` |
| `ENVIRONMENT` | var | **wrangler defaults to production**; override to development in `.dev.vars` locally |
| `BETTER_AUTH_SECRET` | secret | Session signing |
| `PASSWORD_PEPPER` | secret | HMAC key for password derivation, ≥32 bytes |
| `GOOGLE_CLIENT_ID/SECRET` | secret | OAuth |
| `GITHUB_CLIENT_ID/SECRET` | secret | OAuth |
| `RESEND_API_KEY` | secret | Email |
| `RESEND_WEBHOOK_SECRET` | secret | Svix signature |
| `TURNSTILE_SECRET` | secret | siteverify |
| `TURNSTILE_SITE_KEY` | var (optional) | Public Site Key; `1x00000000000000000000AA` for local/testing, production should write it from the admin integrations |
| `ADMIN_EMAILS` | var/secret | Comma-separated; the first verified match is promoted to admin |
| `IP_HASH_SALT` | secret | Audit log IP hashing |
| `R2_ACCOUNT_ID` | secret | R2 S3 endpoint account; may be the same as the Cloudflare account id |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | secret | R2 API Token (S3-compatible keys), used only for presigned PUT; not a Cloudflare API Token |
| `R2_BUCKET_NAME` | var | `forum-assets`, used to build the bucket path when presigning |
| `CF_VERSION_METADATA` | binding | Worker version in health checks/logs |
| `DEV_RESET_TOKEN` | secret (local only) | `/api/dev/reset` requires `x-dev-reset-token`; the endpoint 404s when not development or not configured |

`/api/dev/reset` is for local testing only and requires both `ENVIRONMENT=development` and a valid token; the production build's `wrangler.jsonc` defaults to `ENVIRONMENT=production`, and CI checks that default together with the test Turnstile key. The non-secret identifiers and secrets for Turnstile, Resend and R2 can be maintained at `/admin/integrations`: non-secrets are written to `settings.integration.*`, secrets are encrypted with AES-GCM and written to `settings.secrets.*`, and at runtime database values take precedence, falling back to the Worker variables in the table above. Secrets are never echoed through `/api/site` or admin GET endpoints.

## Caching strategy

- Config: 45s isolate memory cache for normal domains; 5s for security domains (maintenance/registration/verification/Turnstile/noindex).
- `GET /api/site`: `s-maxage=60`; `GET /api/me`: `no-store`. **Responses containing user state never enter the cache.**
- Topic document meta: `caches.default` 300s, keyed by full path and config version.
- sitemap 1h; static assets immutable.

## Why not Pages

Pages requires Pages Functions to inject meta and generate sitemap/manifest, which amounts to splitting a single Worker into two runtimes; it also introduces CORS, cross-origin cookies, untestable preview-environment login, and two deployments. A single Worker keeps deploy-on-git-push (Workers Builds or GitHub Actions) while static assets still go through the CDN. If it ever needs splitting, point `dist/` at Pages and the frontend code stays unchanged.
