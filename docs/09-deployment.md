# 09 Deployment and Fork Guide

English | [简体中文](zh-CN/09-deployment.md)

Pineboard is an open-source forum built on a single Worker + D1 + R2. The upstream repository contains placeholder configuration only; real site configuration never enters Git.

## 0. Two ways to use it

| Approach | Best for | Syncing upstream |
|---|---|---|
| Clone directly / own repository | One-off deployment | Manual fetch |
| GitHub Fork (public) | Public sites, wanting to click "Sync fork" | GitHub Sync fork |
| Private mirror | Sites that must stay private | `git fetch upstream && git merge --ff-only` |

> A GitHub Fork of a public repository cannot be made private. If you need a private site, use a private mirror with an `upstream` remote instead of a GitHub Fork.

## 1. Create resources

```bash
pnpm install
pnpm exec wrangler login

pnpm exec wrangler d1 create pineboard
pnpm exec wrangler r2 bucket create pineboard-assets
pnpm exec wrangler r2 bucket create pineboard-backups
```

Resource names can be changed, but you must update the GitHub Variables to match:

```text
D1_DATABASE_NAME
D1_DATABASE_ID
R2_BUCKET_NAME
R2_BACKUP_BUCKET
```

## 2. Local configuration

```bash
pnpm run setup
```

The wizard generates two **ignored** files:

- `wrangler.site.jsonc`: real Worker/D1/R2/domain configuration
- `.dev.vars`: local authentication secrets and development configuration

It does not modify any tracked files.

Non-interactive:

```bash
pnpm run setup -- --worker pineboard --domain forum.example.com --cdn "" \
  --database-id <D1_ID> --admin-email you@example.com
```

> The current `setup.mjs` also supports `--d1-name` / `--r2-name` / `--dry-run`.

## 3. Required Cloudflare configuration

### Worker Secrets

```bash
pnpm exec wrangler secret put BETTER_AUTH_SECRET
pnpm exec wrangler secret put PASSWORD_PEPPER
pnpm exec wrangler secret put IP_HASH_SALT
# Optional: first admin bootstrap
pnpm exec wrangler secret put ADMIN_EMAILS
```

Generate secrets:

```bash
openssl rand -base64 48
```

**Do not rotate `BETTER_AUTH_SECRET` casually once it is used in production**: it also encrypts the Resend/Turnstile/R2 keys stored in D1.

### Worker vars

In `wrangler.site.jsonc`:

```text
SITE_URL=https://your-domain
ENVIRONMENT=production
R2_BUCKET_NAME
CDN_URL (may be left empty)
```

### GitHub Variables (for deployment)

Set these in the fork/mirror under **Settings → Variables**:

```text
WORKER_NAME
SITE_URL
DOMAIN
D1_DATABASE_NAME
D1_DATABASE_ID
R2_BUCKET_NAME
R2_BACKUP_BUCKET
CDN_URL
```

### GitHub Environment Secrets

Set these in the `production` environment:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

Forks do not inherit these settings; you must create them again.

## 4. Deployment

```bash
# CI only
git push origin main

# Real deployment
git tag v0.2.0
git push origin v0.2.0
```

The Deploy workflow:

1. `render-wrangler.mjs` generates `wrangler.site.jsonc` from GitHub Variables
2. `wrangler d1 migrations apply ... --remote`
3. typecheck + test
4. Required Worker Secrets validation
5. `pnpm build`
6. `wrangler deploy --config wrangler.site.jsonc`
7. `SITE_URL/api/health` smoke test

## 5. First administrator

Recommended:

1. Set `ADMIN_EMAILS=you@example.com`
2. Register and verify your email
3. The Auth hook automatically promotes you to admin

Or run this after registering:

```bash
pnpm exec wrangler d1 execute D1_DATABASE_NAME --remote \
  --command "UPDATE user SET role='admin', email_verified=1 WHERE email='you@example.com'"
```

Do not write the password hash directly.

## 6. Admin initialization

Log in to `/admin`:

1. Site settings: site name, description, URL, announcement
2. SEO: title template, homepage SEO, sitemap
3. Categories / tags / navigation
4. User management: roles, bans
5. Integration configuration: Turnstile / Resend / R2
6. Email settings: budget, digest window
7. Maintenance: rebuild search index

Anything that can be maintained from the admin panel does not require code changes. The only things that cannot be maintained from the admin panel are: D1/R2/ASSETS bindings, `SITE_URL`, `ENVIRONMENT`, and the three root authentication secrets.

## 7. Turnstile / Resend / R2

- Turnstile: create a widget, fill the Site Key + Secret into the admin panel; `/api/health` should show `turnstileConfigured=true`.
- Resend: verify the sending domain, fill the API Key + from address into the admin panel; the Webhook Secret is used for bounces.
- R2 direct upload: create an S3 API Token, fill in Account ID / Bucket / Key; R2 CORS must allow the site domain, PUT, and `content-type,content-length`.
- `CDN_URL` is optional; set it to the public read address of the R2 custom domain/CDN. If unset, `/files/*` is used. After setting it, you must confirm that the domain returns 200 rather than 525.

## 8. Backup / restore / rollback

- `.github/workflows/backup.yml`: exports table by table, skipping FTS virtual tables
- `scripts/check-backup-tables.mjs`: reconciles `sqlite_master` with the backup manifest
- `scripts/order-restore.mjs`: reorders by FK dependency order
- `post_search` must be rebuilt after restoring
- Worker rollback: Cloudflare Dashboard or `wrangler rollback`
- Migrations are additive by default; do not run production migrations in reverse

## 9. Fork / Mirror synchronization

### Public GitHub Fork

Use "Sync fork" or:

```bash
git fetch upstream
git merge --ff-only upstream/main
git push origin main
```

### Private mirror

```bash
git clone https://github.com/hmilyld/pineboard.git forum.example.com
cd forum.example.com
gh repo create <owner>/forum.example.com --private --source=. --remote=origin --push
git remote add upstream https://github.com/hmilyld/pineboard.git
```

Syncing:

```bash
git fetch upstream
git merge --ff-only upstream/main
git push origin main
```

Deploy with a site tag such as `v0.1.1-site.1`; tags only point at commits and do not create code differences.

### Prerequisites for conflict-free syncs

- Do not modify any tracked file
- Configuration lives only in Variables/Secrets/D1 settings
- All locally generated files are ignored
- Do not commit site documentation/screenshots downstream

## 10. CDN_URL

`CDN_URL` only affects the **read** URLs of uploaded files and site images:

```text
Set: https://cdn.example.com/uploads/...
Empty: /files/uploads/... (Worker proxies R2)
```

Presigned uploads still go directly to the R2 S3 endpoint and do not pass through the CDN. Keep it empty when no R2 custom domain is configured.

## 11. Open-source cleanup checklist

- [ ] Replace all production Domain / D1 ID / R2 bucket / Worker names
- [ ] Rotate or generate new authentication secrets
- [ ] Delete `.dev.vars`, `wrangler.site.jsonc`, `.backup/`, `.wrangler/`, `.env*`
- [ ] Check that git history contains no secrets (upstream should have a fresh history)
- [ ] Replace/remove personal screenshots and real content
- [ ] LICENSE is MIT
- [ ] Enable GitHub secret scanning

## 12. FAQ

**missing required Worker secrets**
Missing `BETTER_AUTH_SECRET` / `PASSWORD_PEPPER` / `IP_HASH_SALT`.

**wrangler.site.jsonc does not exist**
Run `pnpm run setup` locally; in CI it is generated by `render-wrangler.mjs`.

**Upload sign reports not configured**
R2 Account/Bucket/S3 Key is missing.

**sitemap is taken over by the SPA**
Confirm the SW denylist in `vite.config.ts` and that `pnpm test:p6:build` passes.

**CDN images return 525**
`CDN_URL` points to a domain that is not connected to R2; clear it first or fix the R2 custom domain.
