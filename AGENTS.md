# AGENTS.md — Development, Design, and Operations Guidelines

English | [简体中文](AGENTS.zh-CN.md)

This file is the **agent entry point** for taking over the project. Read the following in order before starting work:

1. `AGENTS.md` (this file)
2. `docs/README.md` (documentation guide)
3. `docs/01-architecture.md`
4. `docs/02-data-api-config.md`
5. `docs/03-auth-permissions-email.md`
6. `docs/04-content-turnstile-search-upload.md`
7. `docs/05-frontend-theming-ops.md`
8. `docs/06-roadmap-risks.md`
9. `docs/07-design-spec.md`
10. `docs/08-configuration.md`
11. `docs/09-deployment.md`

The design is final; do not reopen settled matters. When you find a conflict between documentation and code, **fix the documentation before changing the code**; do not stuff the guidelines back into `README.md`.

## 1. Product and Design Direction

Pineboard is a lightweight forum centered on topics and replies, with the visual metaphor of "shared workbench + field manual":

- High information density, aligned columns, scannable numbers
- 1px hairlines, minimal rounded corners; no stacked card shadows
- Deep pine green `#14513f` as the brand base color, orange `#e2542c` as the accent color
- Site-wide unified v2-* tokens, light and dark themes
- Do not introduce content-site/SaaS-dashboard layouts; do not add decorative large images or marketing blocks

See `docs/07-design-spec.md` for the full token set, page specifications, responsive breakpoints, and component rules.

### Layouts finalized in v0.2

- Site-wide outer frame uniformly centered at `1180px`
- List pages: main column + `176px` right rail (home, category, tag list, tag detail, search)
- Content pages: full-width 1180, no right rail (topic detail, new topic, edit, revision history)
- Personal center/public profile: 1180, left navigation 188
- Login/register: 1180, two columns
- Post author rail: `140px + minmax(0,1fr)`; single column on mobile
- Error pages also use the 1180 frame

Do not reintroduce the `760/780/1024/1040` page-width tiers.

## 2. Inviolable Technical Constraints

1. **Single Worker**: frontend build output is served through `assets.directory`; the Worker only handles `/api/*` and document requests. Do not introduce Pages, SSR, or a second deployment unit.
2. **Password pipeline**: browser-side PBKDF2 derivation → Better Auth custom `password.hash/verify` performing HMAC-SHA256(pepper). Do not run scrypt/argon2 in the Worker.
3. **Cookie**: host-only, no `Domain`, `SameSite=Lax`, `Secure`, `HttpOnly`. Do not enable `crossSubDomainCookies`.
4. **R2 upload**: presigned PUT; SVG/HTML forbidden; `complete` must HEAD-verify size and MIME; direct upload requires magic bytes validation.
5. **FTS5**: `post_search` uses `post_uid UNINDEXED`; do not treat the TEXT primary key as rowid; `MATCH` queries must be escaped server-side.
6. **Turnstile order**: parameter validation → permissions/email verification → rate limiting → siteverify → database write. Edits count as writes (`post_edit`). A failed verification must make the frontend call `reset()`; with no Site Key, frontend and backend consistently treat it as disabled.
7. **Email**: no awaiting Resend on the request path. Use `c.executionCtx.waitUntil()` for verification/reset/mention; reply notifications only write to `notifications` and are sent as a Cron digest. Sending functions must try/catch internally and write `email_logs`.
8. **Edit history**: complete the snapshot + invalidate old FTS + write new FTS + CAS update of the main table within one `db.batch()`, and use `meta.changes` to determine 409.
9. **Time**: always `INTEGER` unix seconds (UTC) in the database; the presentation layer uses `Intl` according to the site timezone or the browser timezone.
10. **Migrations**: additive migrations only by default; deployment order `migrations → API → frontend`.
11. **Single configuration entry point**: for the boundary between CF variables/Secrets and D1 `settings`, see `docs/08-configuration.md`; do not create a separate set of environment variables in code.
12. **Authentication status**: users in the account-deletion grace period can read and can explicitly revoke, but cannot perform write operations or admin/moderation operations. `requireAdmin` / `requireModerator` must also require `status='active'`.

## 3. Settled Architecture Decisions

- Single Worker + Static Assets; no Pages.
- Configuration via the D1 `settings` key-value table + short cache; no KV.
- Integration secrets prefer the database (AES-GCM); environment variables are fallback only.
- Better Auth uses D1 with transactions disabled; rely on single statements/CAS rather than interactive transactions.
- Certificate login, OAuth, moderation queue, and drafts are future scope.
- Only topics can be pinned; replies can only be deleted/hidden.
- Notification emails go through `notifications` + a 5-minute Cron digest; verification/reset/mention use `waitUntil` per request.
- Version releases trigger Cloudflare deployment only via `v*` tags; ordinary `main` pushes only run CI.

## 4. Code Conventions

- Single-repo pnpm workspace: `apps/api`, `apps/web`, `packages/shared`, `packages/db`.
- Shared types and Zod contracts live in `packages/shared`; frontend and backend must not each write their own (including the API envelope).
- All APIs return `{ ok, data, meta? }` or `{ ok:false, error:{ code, message, fields? } }`; for error codes see `docs/02`.
- New configuration items must be synchronized across `DEFAULTS`, the Zod schema, the admin grouping, and `docs/02`/`docs/08`.
- Database changes must include a migration and be recorded in `docs/02`; handwritten migrations must explain the reason.
- New UI should first reuse existing components such as `v2-*` tokens, `ConfirmDialog`, `ErrorState`, `PaginationBar`, `BrandMark`.
- Do not use `window.confirm` anymore; dangerous operations go through the shared ConfirmDialog.
- Long titles and long topic names must wrap or be truncated; they must not break the grid.
- All write requests must have a pending state to prevent duplicate submission on double-click.

## 5. Migration Exception

`0013_nav_dropdown.sql` is the project's **only explicit table rebuild**: SQLite cannot `ALTER CHECK`, so adding `parent_id` and the `dropdown` type to `nav_items` requires copying the whole table.

Subsequent migrations remain additive by default; if a table rebuild is truly necessary, the reason, data-copy plan, and rollback approach must be stated at the same time in the migration file, `docs/02`, and the PR description.

## 6. Testing and Release

```bash
pnpm run setup   # First run only: interactively configure domain/D1/site name and generate .dev.vars
pnpm dev
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e:v2
pnpm test:e2e:p1 ... p6
pnpm test:p6:build
```

Release process:

```bash
# Normal development
git push origin main          # CI only

# Release
git tag v0.2.6
git push origin v0.2.6        # Triggers Deploy: migrations → required Secrets check → build → deploy → smoke
```

Pre-deployment checks:

```bash
pnpm check:deploy-env
wrangler secret list --format json
```

## 7. Documentation Rules

- `README.md` keeps only the system overview, features, tech stack, repository structure, quick start, and documentation entry points.
- This file keeps the agent workflow, design direction, technical constraints, and release guidelines.
- `docs/README.md` is the guide to all documentation; new documents must be registered there.
- Architecture/API/permissions/email/search/upload/configuration/deployment live in `docs/01`–`docs/09` respectively.
- `docs/07` is the sole source of truth for visuals; `docs/08` is the sole configuration inventory; `docs/09` contains the open-source deployment steps.
- Documentation changes go in the same PR as code changes; do not change only the code.
- English is the default documentation language. Simplified Chinese versions live in `docs/zh-CN/` (root-level files use `*.zh-CN.md`), and every page links to its counterpart through the language switcher at the top.
- Update both language versions in the same commit; do not let them drift.

## 8. Configuration and Open-Source Boundaries

- Upstream `wrangler.jsonc` contains placeholder resources only; real deployment configuration is generated by `wrangler.site.jsonc` and is not tracked in Git.
- Downstream sites provide site differences only through GitHub Variables / Secrets / D1 settings / R2 objects, and do not modify tracked files.
- Do not commit `.dev.vars`, `wrangler.site.jsonc`, `.env*`, backups, production databases, or uploaded objects.
- Run `pnpm check:deploy-env` before an open-source release and confirm the repository history contains no secrets.
