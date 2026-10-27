# Contributing

English | [简体中文](CONTRIBUTING.zh-CN.md)

1. Read `AGENTS.md` and `docs/README.md` first.
2. Fork the repository and create a branch from `main`.
3. Run the following before committing:

```bash
pnpm typecheck
pnpm test
pnpm build
```

4. For changes involving the API/data/permissions, add corresponding e2e tests.
5. Do not commit `.dev.vars`, `wrangler.site.jsonc`, real D1/R2 IDs, domains, backups, or production data.
6. Documentation and code go in the same PR; new configuration must be synchronized with `docs/02`/`docs/08`.
7. Use the `feat:` / `fix:` / `docs:` / `chore:` prefixes in commit messages.

See `AGENTS.md` for the design direction and the inviolable constraints. Do not reopen settled matters.
