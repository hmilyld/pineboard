# Security

## 报告漏洞

请不要在公开 issue 中粘贴利用细节、密钥、用户数据或生产 URL。
通过 GitHub Security Advisories 私下报告，或联系维护者。

## 部署者注意

- 不要提交 `.dev.vars`、`.env*`、`wrangler.site.jsonc`、备份或 D1 导出。
- 使用独立随机值生成 `BETTER_AUTH_SECRET`、`PASSWORD_PEPPER`、`IP_HASH_SALT`。
- 定期轮换 Resend/Turnstile/R2 密钥；`BETTER_AUTH_SECRET` 轮换前先迁移加密集成密钥。
- 开启 GitHub secret scanning / push protection。
- 生产 D1/R2 只允许部署者与最小权限 token 访问。
