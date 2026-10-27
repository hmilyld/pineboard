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

## Testing strategy

- `pnpm typecheck`: four workspace packages
- `pnpm test`: shared contracts, config, stats
- `pnpm test:e2e:v2`: API contracts and pagination
- `pnpm test:e2e:p1…p6`: authentication, content, editing, notifications, reports, SEO
- `pnpm test:p6:build`: PWA, build output, SW denylist

Before a release, at minimum: typecheck, unit, build, P6 build check; run the corresponding e2e when APIs/data change.

## Known boundaries

- Better Auth does not use interactive transactions on D1; it relies on single statements/CAS.
- Migrations are additive by default; `0013_nav_dropdown.sql` is the only table-rebuild exception.
- Production D1/R2/domains belong to the deployer and do not enter the upstream repository.
