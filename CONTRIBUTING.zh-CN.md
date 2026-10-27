# Contributing

[English](CONTRIBUTING.md) | 简体中文

1. 先读 `AGENTS.zh-CN.md` 和 `docs/zh-CN/README.md`。
2. Fork 仓库，从 `main` 建分支。
3. 提交前运行：

```bash
pnpm typecheck
pnpm test
pnpm build
```

4. 涉及 API/数据/权限的改动，补对应 e2e。
5. 不要提交 `.dev.vars`、`wrangler.site.jsonc`、真实 D1/R2 ID、域名、备份或生产数据。
6. 文档与代码同一 PR；新增配置必须同步 `docs/02`/`docs/08`。
7. 提交信息用 `feat:` / `fix:` / `docs:` / `chore:` 前缀。

设计方向与不可违反的约束见 `AGENTS.md`。不要重新讨论已定事项。
