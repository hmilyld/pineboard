# 05 Frontend, Theming, Deployment and Operations

English | [简体中文](zh-CN/05-frontend-theming-ops.md)

## Frontend structure

Vue 3 + TS + Vite + Tailwind v4 (`@tailwindcss/vite`) + shadcn-vue (Reka UI) + Vue Router + Pinia + vite-plugin-pwa.

```
apps/web/src/
├─ pages/            # route pages
├─ components/       # TopicList, PostItem, MarkdownEditor, TurnstileWidget, TagPicker…
├─ composables/      # useApi, usePagination, usePermission, useTime
├─ stores/           # session, config, notifications, ui
├─ theme/            # theme contract, registry, themes/
└─ lib/              # password derivation, formatting, validation
```

**Pinia holds only four kinds of global state**: session, config, unread count, editor drafts. List data uses `useApi` + `usePagination`; no extra data layer is introduced.

## Routes

| Path | Page | Guard |
|---|---|---|
| `/` | Home: categories + latest/popular | Public |
| `/c/:slug` | Category topic list | Public |
| `/t/:id` | Topic detail + posts + threaded replies | Public |
| `/new?category=` | Create topic | Verified |
| `/t/:id/edit` | Edit topic | Author/moderator/admin |
| `/tags`, `/tag/:slug` | Tags | Public |
| `/search?q=` | Search | Public |
| `/u/:username` | User profile | Public |
| `/me`, `/me/topics|replies|bookmarks` | Personal center | Signed in |
| `/me/preferences`, `/me/security` | Preferences, change password/delete account | Signed in |
| `/notifications` | In-site notifications | Signed in |
| `/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email` | Authentication | Public |
| `/unsubscribe?token=` | Unsubscribe confirmation | Public |
| `/admin/*` | Overview/category maintenance/tag maintenance/navigation maintenance/site settings/integrations/email/maintenance; moderators can only enter `/admin/reports` | Admin; `/admin/reports` allows moderators |
| `/403`, `/404`, `/410` | Error pages | Public |

## Theme system (three layers)

1. **Design tokens (no redeploy needed)**: `theme.tokens` stores colors/radii/fonts/density, injected as `:root` CSS variables at startup; shadcn-vue reads these variables natively. Edited at `/admin/appearance`, takes effect within 45s.
2. **Layout variants (no redeploy needed)**: `theme.layout = classic | compact | card`, switching layout components with `<component :is>`, sharing business components.
3. **Theme packages (frontend redeploy required)**:

```
apps/web/src/theme/
├─ contract.ts     # ThemeModule { apiVersion, Layout, components? }
├─ registry.ts     # explicit registration, static import paths
└─ themes/default/theme.json + Layout.vue
```

Only `theme.layout` and `theme.tokens` are implemented today; the theme package registry is a planned capability, and the `theme.package` setting has been removed to avoid an ineffective switch.

**Forbidden**: uploading a theme zip/JS to R2 and executing it dynamically (arbitrary code = XSS + data exfiltration). Themes can only be built inside the repository. Token names must match `--[a-z0-9-]+`, and values reject `url(`, `expression`, `@import`.


## Visual direction: Pineboard v2 (finalized 2026-10)

**The visual spec in `docs/07-design-spec.md` is the single source of truth.** The v2 implementation was completed on 2026-10-23: deep pine green 56px header, 36 announcement bar, 52 topic rows, 176 right column, 96 author column, 20 posts/page, 188 personal center/admin sidebar (the home category chip bar was removed on 2026-10-25); the v1.1 Song typeface large headings and masthead have been removed.

Key points:

- Deep pine green full-width 56px header + 36 announcement + 52px topic rows + 176 right column (the home page no longer renders the category chip bar; category entry points are the top navigation dropdown and the right column)
- Sans-serif site-wide; the Song typeface is kept only for the brand "工" seal mark; numbers use tabular-nums (already implemented)
- Pine green handles structure and actions, orange handles status and primary actions, ochre yellow handles digest/announcements/hints
- 1px hairlines, no card shadows, radii ≤6; information density over whitespace
- Page-level dimensions, components, responsiveness and API gaps are in `docs/07`. Design screenshots are not shipped upstream; run the site and regenerate them per the actual pages.

Theme tokens are still overridden by `theme.tokens`; defaults live in `:root` / `.dark` in `styles.css`. The admin theme package/layout fields remain, but the current default implements only the classic layout.

## Time and display

UTC seconds in the database; the frontend uniformly uses `<RelativeTime>`, with `title` showing the absolute time in the site timezone and the text showing relative time; users can choose to follow the browser timezone or the site timezone. `Intl.DateTimeFormat` handles DST.

## SEO

- The Worker injects `title`, description, `og:*`, `twitter:card`, canonical, robots, hreflang and JSON-LD for `/`, `/t/*`, `/c/*`, `/u/*`, `/tag/*`; the home page uses `WebSite`, topics use `DiscussionForumPosting`, categories/tags use `CollectionPage`, and user pages use `ProfilePage`. After JSON.stringify, `<` is converted to `\u003c` to prevent injection.
- Missing topics return a 404/410 status code (still rendering the SPA shell); hidden/pending topics do not leak their titles.
- `/sitemap.xml` contains the home page, `/tags`, visible categories, enabled tags and `published` topics; topics carry `lastmod`, and hidden content is not output. Returns 404 when `sitemapEnabled` is off in config or `noindex` is on.
- `/robots.txt` is output according to `seo.noindex`; it blocks `/api`, `/search`, `/me`, `/notifications`, `/new`, login/register/reset/verify/unsubscribe, `/admin`, `/mod`.
- Admin "Site settings → SEO" can edit the title template, home title/description, site-wide noindex, and the sitemap switch.
- `/manifest.webmanifest` is generated dynamically by the Worker (name, theme color, icons pointing to R2).

## PWA

- `generateSW`, precaching the app shell and static assets; `/api/**` and `/files/**` are always `NetworkOnly`; navigation is `NetworkFirst` (3s timeout falls back to the shell).
- `registerType:'prompt'`, prompting in-site about a new version and calling `skipWaiting` after user confirmation.
- When `feature.pwa=false`, the frontend calls `unregister()` and clears the cache.
- Offline shows a read-only cached page, disables posting and displays a banner.

## P6 implementation (local)

Document meta injection, `caches.default` 300s, sitemap/robots/manifest, PWA generateSW (new version prompt, API NetworkOnly), static `_headers` CSP, and daily cleanup/reconciliation are in place. After binding the custom domain remotely, Lighthouse and real-device offline behavior need to be re-tested.

## Deployment

```jsonc
// wrangler.jsonc (highlights)
{
  "name": "pineboard",
  "compatibility_date": "2026-10-01",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "./apps/web/dist/client",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/", "/api/*", "/t/*", "/c/*", "/u/*", "/tag/*", "/sitemap.xml", "/robots.txt", "/manifest.webmanifest"]
  },
  "d1_databases": [{ "binding": "DB", "database_name": "forum", "migrations_dir": "packages/db/migrations" }],
  "r2_buckets": [{ "binding": "BUCKET", "bucket_name": "forum-assets" }],
  "triggers": { "crons": ["*/5 * * * *", "15 3 * * *"] }
}
```

- Deployment strategy: ordinary pushes only run CI; only an explicit `v*` tag push triggers a production deployment (`pnpm install` → `wrangler d1 migrations apply --remote` → typecheck/test → required Secrets validation → build → `wrangler deploy --var ENVIRONMENT:production`). Migrations only add, never drop; API before frontend. The repository already ships `ci.yml` / `deploy.yml` / `backup.yml` / `rollback.yml` (Spike 5 passes actionlint, remote execution awaits credentials).
- Preview: `wrangler versions upload` generates a same-origin preview URL; OAuth preview requires adding the preview domain to the callback allowlist, or using a staging custom domain directly. Local `pnpm dev` uses `@cloudflare/vite-plugin`, with D1/R2 state pinned to the root `.wrangler/state`, consistent with `pnpm db:migrate`; `pnpm build` outputs `apps/web/dist/client` (frontend) and `apps/web/dist/forum_hmilyd` (Worker).
- Rollback: `wrangler rollback` or a console version rollback; because migrations are additive, a full rollback is safe.
- Backup: GitHub Actions runs daily `wrangler d1 export --remote` → gzip → R2 backup bucket, keeping 7 copies; D1 Time Travel as a fallback. **Do not use a Worker Cron for backups** (10ms CPU is not enough).
  - **Spike finding: D1 export does not support FTS5 virtual tables** (`cannot export databases with Virtual Tables (fts5)`), and a full export fails outright. Backups must use `--no-schema --table <real tables...>` and exclude `post_search`; the restore order is apply migrations to a new database → import data → rebuild the search index. `post_search` is derived data and may be rebuilt.
  - Stop `wrangler dev` before migrating: running `d1 migrations apply --local` while local dev holds the D1 file lock causes `SQLITE_BUSY`.
- Domains: `forum.example.com` bound to the Worker custom domain; `cdn.example.com` bound to R2; `mail.example.com` used for Resend (SPF/DKIM/DMARC).
- OAuth: one Google app, callback `https://forum.example.com/api/auth/callback/google`; two GitHub apps, local/production. Locally `localhost:8787` and the frontend `localhost:5173` (Vite proxies `/api` to 8787 to avoid cross-origin).
- Environment variables/secrets are in `docs/01`. `.dev.vars` is not committed.

## Security headers

The Worker returns for documents and API: CSP (`script-src 'self' https://challenges.cloudflare.com`, `frame-src https://challenges.cloudflare.com`, `img-src 'self' https://cdn.example.com data:`), `Referrer-Policy: strict-origin-when-cross-origin` (`no-referrer` for token pages), `X-Frame-Options: DENY`, `Permissions-Policy`, HSTS (at the Cloudflare layer).
Same-origin requests still validate `Origin` (write requests) and keep `SameSite=Lax`.

## Free tier budget (100 DAU / 500 views per day / 50 posts per day)

| Resource | Estimate | Quota | Headroom |
|---|---|---|---|
| Worker requests (API+documents) | 8–10k/day | 100k/day | ~90% |
| Static assets | Free, unlimited | — | — |
| D1 reads | ~40k rows/day | 5M/day | >99% |
| D1 writes | ~3k rows/day | 100k/day | ~97% |
| R2 | 2–3GB/month | 10GB | Needs orphan cleanup |
| Resend | 10–30 emails/day | 100/day | Main bottleneck |
| CPU | 1–4ms/request | 10ms | Medium-low |

What really needs watching is **Resend's 100 emails/day** and **Better Auth's CPU behavior**. The former relies on digests/budgets/unsubscribe, the latter on client-side password derivation.
