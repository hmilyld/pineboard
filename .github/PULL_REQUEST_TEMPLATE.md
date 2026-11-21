## Summary

<!-- What changes, and why. Link the issue when there is one. -->

## Type of change

- [ ] Bug fix
- [ ] Feature
- [ ] Refactor / tooling / CI
- [ ] Documentation

## Checklist

- [ ] `pnpm lint && pnpm format:check`
- [ ] `pnpm typecheck && pnpm test`
- [ ] `pnpm build && pnpm test:p6:build`
- [ ] e2e suites run or updated for API, data or permission changes
- [ ] Documentation updated in the same PR (English and `zh-CN`)
- [ ] No secrets, `.dev.vars`, `wrangler.site.jsonc`, backups or production data
- [ ] New dependencies pass `pnpm check:licenses` and are justified in the summary

## Compatibility

- [ ] No change to the public API, CLI, settings keys, data format or migrations
- [ ] Any breaking change is described below with a migration path and SemVer impact

<!-- Migration notes or rollback plan, if needed. -->
