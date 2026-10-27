# 08 配置与部署入口

[English](../08-configuration.md) | 简体中文

> 从零创建 Cloudflare 资源、初始化管理员、备份/回滚与开源清理，见 [09 部署指南](09-deployment.md)。本文只负责运行时配置清单与优先级。

本文是运行时配置的唯一清单。原则：

1. **能启动系统的硬性依赖放 Cloudflare Worker 变量/Secrets**，不依赖数据库。
2. **可运营轮换的集成凭据优先放数据库**（`/admin/integrations`，AES-GCM 加密）；未在 CF 配置时必须有数据库值。
3. **站点业务配置放 D1 `settings`**，按组 Zod 校验，数据库值覆盖 `DEFAULTS`。
4. 一个配置只保留一个主要入口；环境变量只作为运行时兜底，不再复制一份到文档之外。

## 1. 配置来源与优先级

| 来源 | 内容 | 入口 |
|---|---|---|
| `wrangler.jsonc` `vars` | 公开、部署时固定的 Worker 变量 | 仓库配置，随代码部署 |
| Cloudflare Worker Secrets | 启动必需密钥、认证/加密根密钥 | `wrangler secret put` 或 Cloudflare Dashboard |
| D1 `settings` | 站点、SEO、账号、邮件、功能开关、上传、安全、主题、集成非密钥 | `/admin/settings`、`/admin/integrations` |
| D1 `settings` (`secrets.*`) | Resend/Turnstile/R2 密钥密文 | `/admin/integrations` |
| GitHub Environment `production` Secrets | 仅 CI 部署凭据 | GitHub Actions |

覆盖顺序：

```text
secrets.* (DB)                 > RESEND_API_KEY / TURNSTILE_SECRET / R2_* (Worker Secrets)
integration.cloudflare.* (DB)  > R2_ACCOUNT_ID / R2_BUCKET_NAME / CDN_URL / TURNSTILE_SITE_KEY (Worker vars/secrets)
settings.* (DB)                > DEFAULTS
```

`SITE_URL`、`ENVIRONMENT`、`BETTER_AUTH_SECRET`、`PASSWORD_PEPPER`、`IP_HASH_SALT`、`ADMIN_EMAILS`、`EMAIL_TRANSPORT`、`DEV_RESET_TOKEN` **只从 Worker 环境读取，不落数据库**。OAuth 变量当前未启用，已从 `.dev.vars.example` 移除。

## 2. 必须配置（缺失系统不可用）

这些必须在 Cloudflare Worker 部署前配置，不能只放数据库：

| 名称 | 类型 | 说明 |
|---|---|---|
| `DB` | D1 binding | `wrangler.jsonc`，主数据库 |
| `BUCKET` | R2 binding | `wrangler.jsonc`，上传对象存储 |
| `ASSETS` | Assets binding | `wrangler.jsonc`，前端静态产物 |
| `CF_VERSION_METADATA` | binding | `wrangler.jsonc`，健康检查版本 |
| `SITE_URL` | Worker var | 例如 `https://forum.example.com`；Better Auth baseURL，缺失会导致认证请求异常 |
| `ENVIRONMENT` | Worker var | 生产必须为 `production`；本地 `.dev.vars` 覆盖为 `development` |
| `BETTER_AUTH_SECRET` | Worker secret | Better Auth 签名密钥，同时派生集成密钥加密密钥；轮换会导致已存集成密文不可读 |
| `PASSWORD_PEPPER` | Worker secret | 浏览器 PBKDF2 派生后的 HMAC pepper；缺失会使密码链路不安全 |
| `IP_HASH_SALT` | Worker secret | IP 哈希盐；缺失会削弱限流/审计隐私 |

部署 workflow 会在 tag 部署前执行：

```bash
wrangler secret list --format json > /tmp/worker-secrets.json
node scripts/check-worker-secrets.mjs /tmp/worker-secrets.json
```

缺失上述三个必需 Secret 时直接失败，不会部署。

## 3. 功能必需（缺失只影响对应功能）

| 功能 | CF 变量/Secret | 数据库对应项 | 缺失行为 |
|---|---|---|---|
| 上传/R2 | `R2_BUCKET_NAME`、`R2_ACCOUNT_ID`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY` | `integration.cloudflare.r2Bucket/accountId`、`secrets.r2AccessKeyId/r2SecretAccessKey` | `sign` 返回“上传服务未配置”；Worker 直传仍可临时兜底 |
| CDN | `CDN_URL` | `integration.cloudflare.cdnUrl` | 使用 `/files/*` 本地回退 |
| Turnstile | `TURNSTILE_SITE_KEY`、`TURNSTILE_SECRET` | `integration.cloudflare.turnstileSiteKey`、`secrets.turnstileSecret` | 无 Site Key 时前后端按未启用处理；只有 Site Key 无 Secret 时返回 `captcha_unavailable` |
| 邮件/Resend | `RESEND_API_KEY`、`RESEND_WEBHOOK_SECRET` | `secrets.resendApiKey/resendWebhookSecret` | 邮件标记 `skipped`，不发信；生产不会写 dev outbox |
| 管理员引导 | `ADMIN_EMAILS` | 无 | 可选；管理员也可直接由数据库角色控制 |
| 发信通道 | `EMAIL_TRANSPORT` | 无 | 生产省略；本地设 `log` 写 `dev_email_outbox` |
| 本地测试重置 | `DEV_RESET_TOKEN` | 无 | 仅本地；生产设置后端点仍因 `ENVIRONMENT` 非 development 返回 404 |

> “如果不在 CF 环境变量配置，则需要在数据库配置”适用于上表的集成项。推荐生产把 Resend/Turnstile/R2 密钥放数据库，便于轮换；把 `SITE_URL`、`ENVIRONMENT` 和三个认证根密钥放 CF。

## 4. 后台 UI 覆盖范围

以下配置组目前仍只能通过 D1 `settings`/迁移或代码默认值维护，后台设置页尚未提供完整表单（避免把未验证的编辑器暴露给管理员）：

- `edit.*`
- `security.*`
- `upload.*`
- `theme.*`
- `mail` 的预算、摘要窗口、TLL 等高级项
- `feature` 的搜索/举报/游客阅读等细项

站点、SEO、账号基础项、维护模式、分页、Turnstile 上传开关和集成密钥已有 UI。若需要通过后台运营这些组，应先补 UI 与对应 e2e，而不是直接手改生产 D1。

## 5. D1 `settings` 分组

| 分组 | 主要键 | 默认/说明 |
|---|---|---|
| `site` | name, tagline, url, description, keywords, logoKey, faviconKey, ogImageKey, timezone, language, icp, announcement | 默认名称 **Pineboard**；`site.url` 应与 `SITE_URL` 一致 |
| `seo` | titleTemplate, homeTitle, description, noindex, topicsPerPage, postsPerPage, sitemapEnabled | 分页 5–50 |
| `account` | registrationOpen, allowUnverifiedLogin, requireVerificationForWrite, passwordMinLength, usernameMin/Max, sessionDays, deletionGraceDays | 注册/验证/注销策略 |
| `edit` | windowUserMinutes, windowModeratorMinutes, allowStaffEditOthers, lockAfterReply, allowSelfDelete, historyVisibility, keepRevisions, requireReason | 编辑窗口与留痕 |
| `mail` | enabled, fromName, fromAddress, replyTo, notify*, dailyBudget, userDailyCap, digestWindowMinutes, verificationTtlMinutes, resetTtlMinutes, unsubscribeTokenDays | 摘要与邮件预算 |
| `feature` | turnstile, pwa, markdown, search, uploads, reports, guestRead | 功能开关 |
| `maintenance` | enabled, message, allowAdmin | 维护模式 |
| `upload` | imageMaxMb, fileMaxMb, userDailyCount, orphanTtlHours | 类型白名单在代码中固定 |
| `security` | postMinIntervalSeconds, newUserDailyPosts, mentionMaxPerPost, reportDailyLimit, signupPerHour | 频率限制 |
| `integration` | cloudflare.accountId/r2Bucket/cdnUrl/turnstileSiteKey | 缺失回退 CF |
| `theme` | layout, tokens, darkMode | 主题 token |
| `secrets` | resendApiKey, resendWebhookSecret, turnstileSecret, r2AccessKeyId, r2SecretAccessKey | AES-GCM 密文，不回显 |

## 6. 部署入口

### 普通推送

```bash
git push origin main
```

只触发 **CI**（typecheck、单测、构建、部署环境检查），不会部署 Cloudflare。

### 版本发布

明确打 tag 后才触发生产部署：

```bash
git tag v0.2.0
git push origin v0.2.0
```

`Deploy` workflow 只在 `v*` tag（或手动 `workflow_dispatch`）运行：

1. `pnpm db:migrate:remote`
2. `pnpm typecheck` + `pnpm test`
3. 校验必需 Worker Secrets
4. `pnpm build`
5. `wrangler deploy --var ENVIRONMENT:production`
6. `https://forum.example.com/api/health` 冒烟

### 生产初始化顺序（摘要）

```bash
pnpm db:migrate:remote

# 必需 Secret（只做一次，后续轮换才重设）
pnpm exec wrangler secret put BETTER_AUTH_SECRET
pnpm exec wrangler secret put PASSWORD_PEPPER
pnpm exec wrangler secret put IP_HASH_SALT

# 可选：首次管理员引导
pnpm exec wrangler secret put ADMIN_EMAILS

# 发布
git tag v0.2.0 && git push origin v0.2.0
```

完整步骤见 [09 部署指南](09-deployment.md)。部署后到 `/admin/integrations` 配置 Resend/Turnstile/R2，或以 CF 变量提供；确认：

```bash
curl -s https://forum.example.com/api/health
# turnstileConfigured=true  （启用 Turnstile 时）
```

## 7. GitHub Environment Secrets

`production` environment 只需要部署凭据：

| Secret | 用途 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Wrangler 调用 Cloudflare API |
| `CLOUDFLARE_ACCOUNT_ID` | 指定账号 |

它们不是应用运行时变量，不会进入 Worker；运行时的必需密钥仍需在 Worker Secrets 中配置。
