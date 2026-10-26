# 01 架构

## 部署形态

单 Worker + Workers Static Assets，同源部署：

```
Browser
  │ https://forum.example.com
Cloudflare Edge
  ├─ /assets/*、图片等静态文件 ──→ Static Assets（CDN，请求免费且不占 Worker 额度）
  ├─ /api/*                    ──→ Worker（Hono）
  ├─ /t/* /c/* /u/* /tag/*     ──→ Worker：ASSETS.fetch(index.html) + HTMLRewriter 注入 meta
  ├─ /sitemap.xml /robots.txt /manifest.webmanifest ──→ Worker 动态生成
  ├─ D1：论坛、Better Auth、settings、FTS5、日志
  ├─ R2：public bucket（cdn.example.com）；预签名直传
  ├─ Resend / Turnstile        ──→ 出站 HTTPS
  └─ Cron：邮件摘要 */5、清理与对账每日
```

Worker 配置要点：`assets.directory = "./apps/web/dist/client"`（Vite client 输出）、`not_found_handling = "single-page-application"`、`run_worker_first = ["/", "/api/*", "/files/*", "/t/*", "/c/*", "/u/*", "/tag/*", "/sitemap.xml", "/robots.txt", "/manifest.webmanifest"]`。

> P0 先只启用 `/api/*`，否则尚未实现的 `/t/*` 等文档路由会被空 Worker 接住、破坏 SPA fallback；P6 实现 meta 注入时再一次性加入其余路径。

## 请求链路

**读主题（匿名）**：Worker → 配置（45s 缓存）→ 可选鉴权 → 2 条 D1 查询（主题+首帖+标签；回复分页）→ JSON。文档导航额外注入 meta，`caches.default` 缓存 300s。

**发帖**：鉴权 → 邮箱已验证 → 写频率限制 → 载荷校验 → Turnstile → D1 单 batch（插 post、主题计数/lastPostAt、FTS、mentions、notifications、audit）→ 201。不 await 邮件。

**注册/重置**：Turnstile（注册）→ Better Auth → hook 内 `waitUntil` 发信 → 立即响应。

**文档请求**：`/`、`/t/:id`、`/c/:slug`、`/tag/:slug`、`/u/:username` → 取 meta（缓存）→ `ASSETS.fetch('/index.html')` → HTMLRewriter 改 title/description/og/canonical/robots，注入 JSON-LD；不存在的内容返回 404/410 状态码但仍渲染 SPA 壳。

## 目录结构

```
forum.example.com/
├─ apps/api/          # Hono 路由、服务、Better Auth、Drizzle
├─ apps/web/          # Vue3 + Vite + Tailwind v4 + shadcn-vue
├─ packages/shared/   # Zod 契约、错误码、配置默认值、权限枚举
├─ packages/db/       # schema、drizzle-kit、migrations
├─ docs/
└─ wrangler.jsonc     # 根级部署配置（assets 指向 apps/web/dist）
```

## 绑定与环境变量

> 完整配置清单、优先级与 tag 部署流程见 `docs/08-configuration.md`。

| 名称 | 类型 | 说明 |
|---|---|---|
| `DB` | D1 | 主库 |
| `BUCKET` | R2 | 头像/附件/站点图 |
| `ASSETS` | Static Assets | 前端产物 |
| `SITE_URL` | var | `https://forum.example.com` |
| `CDN_URL` | var | `https://cdn.example.com` |
| `ENVIRONMENT` | var | **wrangler 默认 production**；本地在 `.dev.vars` 覆盖为 development |
| `BETTER_AUTH_SECRET` | secret | 会话签名 |
| `PASSWORD_PEPPER` | secret | 派生密码的 HMAC 密钥，≥32 字节 |
| `GOOGLE_CLIENT_ID/SECRET` | secret | OAuth |
| `GITHUB_CLIENT_ID/SECRET` | secret | OAuth |
| `RESEND_API_KEY` | secret | 邮件 |
| `RESEND_WEBHOOK_SECRET` | secret | Svix 签名 |
| `TURNSTILE_SECRET` | secret | siteverify |
| `TURNSTILE_SITE_KEY` | var（可选） | 公开 Site Key；本地/测试用 `1x00000000000000000000AA`，生产应从后台集成配置写入 |
| `ADMIN_EMAILS` | var/secret | 逗号分隔；首个已验证命中者升 admin |
| `IP_HASH_SALT` | secret | 审计日志 IP 哈希 |
| `R2_ACCOUNT_ID` | secret | R2 S3 端点账号；可与 Cloudflare account id 相同 |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | secret | R2 API Token（S3 兼容密钥），只用于预签名 PUT；不是 Cloudflare API Token |
| `R2_BUCKET_NAME` | var | `forum-assets`，预签名时拼 bucket 路径 |
| `CF_VERSION_METADATA` | binding | 健康检查/日志中的 Worker 版本 |
| `DEV_RESET_TOKEN` | secret（仅本地） | `/api/dev/reset` 必须携带 `x-dev-reset-token`；非 development 或未配置时端点 404 |

`/api/dev/reset` 仅用于本地测试，需同时满足 `ENVIRONMENT=development` 与 token 校验；生产构建的 `wrangler.jsonc` 默认 `ENVIRONMENT=production`，CI 会检查该默认值与测试 Turnstile key。Turnstile、Resend、R2 的非密钥标识与密钥可在 `/admin/integrations` 维护：非密钥写 `settings.integration.*`，密钥经 AES-GCM 加密后写 `settings.secrets.*`，运行时优先数据库值、回退到上表 Worker 变量。密钥永不通过 `/api/site` 或后台 GET 接口回显。

## 缓存策略

- 配置：普通域 45s isolate 内存缓存；安全域（维护/注册/验证/Turnstile/noindex）5s。
- `GET /api/site`：`s-maxage=60`；`GET /api/me`：`no-store`。**含用户态的响应永不进缓存。**
- 主题文档 meta：`caches.default` 300s，键含完整路径与配置版本。
- sitemap 1h；静态资源 immutable。

## 为什么不用 Pages

Pages 需要 Pages Functions 才能注入 meta、生成 sitemap/manifest，等于把单 Worker 拆成两个运行时；同时引入 CORS、跨域 Cookie、预览环境登录不可测、两套部署。单 Worker 保留 Git push 自动发版（Workers Builds 或 GitHub Actions），静态资源仍走 CDN。将来若要拆，把 `dist/` 指向 Pages 即可，前端代码不动。
