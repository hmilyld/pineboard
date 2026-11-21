# 06 Roadmap, Risks and Testing Strategy

English | [简体中文](zh-CN/06-roadmap-risks.md)

## Roadmap

Pineboard's scope is "a self-hostable lightweight discussion board", with this core roadmap:

1. Authentication, accounts, permissions, notifications and email
2. Topics/replies/tags/search/report/moderation
3. R2 uploads, PWA, SEO, admin operations
4. Observability, backup and restore, and the open-source deployment experience

Out of core scope: OAuth, moderation queue, drafts, external server-side full-text search services, native mobile clients.

## Main risks

| Risk | Impact | Mitigation |
|---|---|---|
| D1 single-statement limit | Batch writes/restores fail | Sharding, CAS, avoid interactive transactions |
| FTS5 and D1 export | Complicated backup/restore | Backups skip `post_search`, rebuild after restore |
| Resend quota/bounces | Emails delayed or stopped | Digests, budgets, suppression list, failure logs |
| Missing Turnstile config | Registration/posting locked out | Skip consistently on both frontend and backend when no Site Key, flag in health check |
| R2 CORS/custom domain | Uploads or image reads fail | Worker direct-upload fallback, `/files/*`, CDN optional |
| Fork config drift | Cannot follow upstream | All site config goes through Variables/Secrets/D1, no editing tracked files |
| Dev-only `esbuild` advisory (`better-auth → drizzle-kit → @esbuild-kit`) | Local tooling only; no production runtime exposure | Track upstream; re-run `pnpm audit --prod` before each release |

## Testing strategy

- `pnpm lint` and `pnpm format:check`
- `pnpm typecheck`: four workspace packages
- `pnpm test:coverage`: unit tests with a coverage ratchet (report first, raise as tests land)
- `pnpm test:e2e:v2`: API contracts and pagination
- `pnpm test:e2e:p1…p6` and `pnpm test:e2e:review`: authentication, content, editing, notifications, reports, SEO and moderation
- `pnpm test:p6:build`: PWA, build output, SW denylist

Before a release, at minimum: lint, formatting, typecheck, unit tests, build and the P6 build check. Run the matching e2e suite when APIs or data change. CI runs all of the above on every pull request.

## Known boundaries

- Better Auth does not use interactive transactions on D1; it relies on single statements/CAS.
- Migrations are additive by default; `0013_nav_dropdown.sql` is the only table-rebuild exception.
- Production D1/R2/domains belong to the deployer and do not enter the upstream repository.
