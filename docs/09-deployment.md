# 09 部署与 Fork 指南

Pineboard 是单 Worker + D1 + R2 的开源论坛。上游仓库只含占位配置；真实站点配置不进入 Git。

## 0. 两种使用方式

| 方式 | 适合 | 同步上游 |
|---|---|---|
| 直接 clone / 自建仓库 | 一次性部署 | 手动 fetch |
| GitHub Fork（public） | 公开站点、希望点 “Sync fork” | GitHub Sync fork |
| Private mirror | 站点必须私有 | `git fetch upstream && git merge --ff-only` |

> public 仓库的 GitHub Fork 不能设为 private。需要私有站点时，用 private mirror + `upstream` remote，而不是 GitHub Fork。

## 1. 创建资源

```bash
pnpm install
pnpm exec wrangler login

pnpm exec wrangler d1 create pineboard
pnpm exec wrangler r2 bucket create pineboard-assets
pnpm exec wrangler r2 bucket create pineboard-backups
```

资源名可以改，但要同步 GitHub Variables：

```text
D1_DATABASE_NAME
D1_DATABASE_ID
R2_BUCKET_NAME
R2_BACKUP_BUCKET
```

## 2. 本地配置

```bash
pnpm setup
```

向导会生成两个 **ignored** 文件：

- `wrangler.site.jsonc`：真实 Worker/D1/R2/域名配置
- `.dev.vars`：本地认证密钥与开发配置

不会修改任何 tracked 文件。

非交互：

```bash
pnpm setup --worker pineboard --domain forum.example.com --cdn "" \
  --database-id <D1_ID> --admin-email you@example.com
```

> 当前 `setup.mjs` 也支持 `--d1-name` / `--r2-name` / `--dry-run`。

## 3. 必须填写的 Cloudflare 配置

### Worker Secrets

```bash
pnpm exec wrangler secret put BETTER_AUTH_SECRET
pnpm exec wrangler secret put PASSWORD_PEPPER
pnpm exec wrangler secret put IP_HASH_SALT
# 可选：首次管理员引导
pnpm exec wrangler secret put ADMIN_EMAILS
```

生成密钥：

```bash
openssl rand -base64 48
```

**`BETTER_AUTH_SECRET` 一旦用于生产，不要随意轮换**：它同时加密 D1 里的 Resend/Turnstile/R2 密钥。

### Worker vars

`wrangler.site.jsonc` 中的：

```text
SITE_URL=https://你的域名
ENVIRONMENT=production
R2_BUCKET_NAME
CDN_URL（可留空）
```

### GitHub Variables（部署时）

在 fork/mirror 的 **Settings → Variables** 设置：

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

在 `production` environment 设置：

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

Fork 不会继承这些设置，必须重新创建。

## 4. 部署

```bash
# 只跑 CI
git push origin main

# 正式部署
git tag v0.1.0
git push origin v0.1.0
```

Deploy workflow：

1. `render-wrangler.mjs` 从 GitHub Variables 生成 `wrangler.site.jsonc`
2. `wrangler d1 migrations apply ... --remote`
3. typecheck + test
4. 必需 Worker Secrets 校验
5. `pnpm build`
6. `wrangler deploy --config wrangler.site.jsonc`
7. `SITE_URL/api/health` smoke

## 5. 首个管理员

推荐：

1. 设置 `ADMIN_EMAILS=you@example.com`
2. 注册并验证邮箱
3. Auth hook 自动提升为 admin

或注册后执行：

```bash
pnpm exec wrangler d1 execute D1_DATABASE_NAME --remote \
  --command "UPDATE user SET role='admin', email_verified=1 WHERE email='you@example.com'"
```

不要直接写密码哈希。

## 6. 后台初始化

登录 `/admin`：

1. 站点设置：站名、描述、URL、公告
2. SEO：标题模板、首页 SEO、sitemap
3. 版块 / 标签 / 导航
4. 用户管理：角色、封禁
5. 集成配置：Turnstile / Resend / R2
6. 邮件设置：预算、摘要窗口
7. 维护：重建搜索索引

可后台维护的项不需要改代码。无法后台维护的只有：D1/R2/ASSETS 绑定、`SITE_URL`、`ENVIRONMENT`、三个认证根密钥。

## 7. Turnstile / Resend / R2

- Turnstile：创建 widget，Site Key + Secret 填后台；`/api/health` 的 `turnstileConfigured=true`。
- Resend：验证发信域名，API Key + from 地址填后台；Webhook Secret 用于退信。
- R2 直传：创建 S3 API Token，填 Account ID / Bucket / Key；R2 CORS 允许站点域名、PUT、`content-type,content-length`。
- `CDN_URL` 可选；设置为 R2 自定义域/CDN 的公开读地址，未设置则走 `/files/*`。设置后必须确认该域名返回 200，而不是 525。

## 8. 备份 / 恢复 / 回滚

- `.github/workflows/backup.yml`：按表导出，跳过 FTS 虚拟表
- `scripts/check-backup-tables.mjs`：对账 `sqlite_master` 与备份清单
- `scripts/order-restore.mjs`：按 FK 顺序重排
- 恢复后必须重建 `post_search`
- Worker 回滚：Cloudflare Dashboard 或 `wrangler rollback`
- 迁移默认 additive；不要反向执行生产 migration

## 9. Fork / Mirror 同步

### Public GitHub Fork

使用 “Sync fork” 或：

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

同步：

```bash
git fetch upstream
git merge --ff-only upstream/main
git push origin main
```

部署用 `v0.1.1-site.1` 这类站点 tag；tag 只指向提交，不制造代码差异。

### 无冲突的前提

- 不修改任何 tracked 文件
- 配置只在 Variables/Secrets/D1 settings
- 本地生成文件全部 ignored
- 不在下游提交站点文档/截图

## 10. CDN_URL

`CDN_URL` 只影响上传文件和站点图片的 **读取** URL：

```text
有值：https://cdn.example.com/uploads/...
空：  /files/uploads/...（Worker 代理 R2）
```

预签名上传仍直接到 R2 S3 endpoint，不经过 CDN。没有配置 R2 自定义域时保持为空。

## 11. 开源清理检查

- [ ] 替换所有生产 Domain / D1 ID / R2 bucket / Worker 名
- [ ] 轮换或生成新的认证密钥
- [ ] 删除 `.dev.vars`、`wrangler.site.jsonc`、`.backup/`、`.wrangler/`、`.env*`
- [ ] 检查 git 历史没有 secret（上游应为全新历史）
- [ ] 替换/删除个人截图和真实内容
- [ ] LICENSE 为 MIT
- [ ] 开启 GitHub secret scanning

## 12. 常见问题

**missing required Worker secrets**
缺 `BETTER_AUTH_SECRET` / `PASSWORD_PEPPER` / `IP_HASH_SALT`。

**wrangler.site.jsonc 不存在**
本地运行 `pnpm setup`；CI 由 `render-wrangler.mjs` 生成。

**上传 sign 报未配置**
R2 Account/Bucket/S3 Key 缺失。

**sitemap 被 SPA 接管**
确认 `vite.config.ts` 的 SW denylist 与 `pnpm test:p6:build` 通过。

**CDN 图片 525**
`CDN_URL` 指向了未接 R2 的域名；先清空或修好 R2 自定义域。
