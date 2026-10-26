# 05 前端、主题、部署与运维

## 前端结构

Vue 3 + TS + Vite + Tailwind v4（`@tailwindcss/vite`）+ shadcn-vue（Reka UI）+ Vue Router + Pinia + vite-plugin-pwa。

```
apps/web/src/
├─ pages/            # 路由页面
├─ components/       # TopicList、PostItem、MarkdownEditor、TurnstileWidget、TagPicker…
├─ composables/      # useApi、usePagination、usePermission、useTime
├─ stores/           # session、config、notifications、ui
├─ theme/            # 主题契约、registry、themes/
└─ lib/              # 派生密码、格式化、校验
```

**Pinia 只放四类全局态**：session、config、未读数、编辑器草稿。列表数据用 `useApi` + `usePagination`，不引入额外数据层。

## 路由

| 路径 | 页面 | 守卫 |
|---|---|---|
| `/` | 首页：版块 + 最新/热门 | 公开 |
| `/c/:slug` | 版块主题列表 | 公开 |
| `/t/:id` | 主题详情 + 楼层 + 楼中楼 | 公开 |
| `/new?category=` | 发帖 | 已验证 |
| `/t/:id/edit` | 编辑主题 | 作者/版主/管理员 |
| `/tags`、`/tag/:slug` | 标签 | 公开 |
| `/search?q=` | 搜索 | 公开 |
| `/u/:username` | 用户主页 | 公开 |
| `/me`、`/me/topics|replies|bookmarks` | 个人中心 | 登录 |
| `/me/preferences`、`/me/security` | 偏好、改密/注销 | 登录 |
| `/notifications` | 站内通知 | 登录 |
| `/login`、`/register`、`/forgot-password`、`/reset-password`、`/verify-email` | 认证 | 公开 |
| `/unsubscribe?token=` | 退订确认 | 公开 |
| `/admin/*` | 概览/版块维护/标签维护/导航维护/站点设置/集成配置/邮件/维护；版主仅可进 `/admin/reports` | 管理员；`/admin/reports` 允许版主 |
| `/403`、`/404`、`/410` | 错误页 | 公开 |

## 主题系统（三层）

1. **设计令牌（免发版）**：`theme.tokens` 存颜色/圆角/字体/密度，启动时注入 `:root` CSS 变量；shadcn-vue 原生读取这些变量。后台 `/admin/appearance` 编辑，45s 内生效。
2. **布局变体（免发版）**：`theme.layout = classic | compact | card`，用 `<component :is>` 切换布局组件，共享业务组件。
3. **主题包（重发前端）**：

```
apps/web/src/theme/
├─ contract.ts     # ThemeModule { apiVersion, Layout, components? }
├─ registry.ts     # 显式登记，静态 import 路径
└─ themes/default/theme.json + Layout.vue
```

当前只实现 `theme.layout` 与 `theme.tokens`；主题包 registry 属于规划能力，`theme.package` 配置已移除，避免出现无效开关。

**禁止**：把主题 zip/JS 传 R2 后动态执行（任意代码 = XSS + 数据外泄）。主题只能仓库内构建。令牌名只允许 `--[a-z0-9-]+`，值拒绝 `url(`、`expression`、`@import`。


## 视觉方向：Pineboard v2（2026-10 定稿）

**视觉规范以 `docs/07-design-spec.md` 为唯一依据。** 2026-10-23 已完成 v2 实现：深松绿 56 页头、36 公告、52 主题行、176 右栏、96 作者栏、20 楼/页、188 个人中心/后台侧栏（首页版块胶囊条已于 2026-10-25 移除）；v1.1 的宋体大标题与刊头已移除。

要点：

- 深松绿通栏页头 56 + 公告 36 + 52px 主题行 + 176 右栏（首页不再渲染版块胶囊条，版块入口在顶部导航下拉与右栏）
- 全站无衬线；宋体只保留给品牌「工」印记；数字使用 tabular-nums（已经实现）
- 松绿负责结构与操作，橙色负责状态与主行动，赭黄负责精华/公告/提示
- 1px 发丝线、无卡片阴影、圆角 ≤6；信息密度优先于留白
- 页面级尺寸、组件、响应式与 API 缺口见 `docs/07`。设计截图不随上游发布，运行站点后按实际页面重新生成。

主题 tokens 仍由 `theme.tokens` 覆盖；默认值在 `styles.css` 的 `:root` / `.dark`。后台主题包/布局字段保留，但当前默认只实现 classic 布局。

## 时间与展示

库内 UTC 秒；前端统一 `<RelativeTime>`，`title` 显示站点时区绝对时间，文本显示相对时间；用户可选跟随浏览器时区或站点时区。`Intl.DateTimeFormat` 处理 DST。

## SEO

- Worker 对 `/`、`/t/*`、`/c/*`、`/u/*`、`/tag/*` 注入 `title`、description、`og:*`、`twitter:card`、canonical、robots、hreflang 与 JSON-LD；首页用 `WebSite`，主题用 `DiscussionForumPosting`，版块/标签用 `CollectionPage`，用户页用 `ProfilePage`。JSON.stringify 后把 `<` 转 `\u003c` 防注入。
- 不存在的主题返回 404/410 状态码（仍渲染 SPA 壳）；隐藏/待审主题不泄露标题。
- `/sitemap.xml` 含首页、`/tags`、可见版块、启用标签与 `published` 主题；主题带 `lastmod`，不输出隐藏内容。配置关闭 `sitemapEnabled` 或开启 `noindex` 时返回 404。
- `/robots.txt` 按 `seo.noindex` 输出；屏蔽 `/api`、`/search`、`/me`、`/notifications`、`/new`、登录/注册/重置/验证/退订、`/admin`、`/mod`。
- 后台「站点设置 → SEO」可编辑标题模板、首页标题/描述、全站 noindex、sitemap 开关。
- `/manifest.webmanifest` 由 Worker 动态生成（名称、主题色、图标指向 R2）。

## PWA

- `generateSW`，precache 应用外壳与静态资源；`/api/**` 与 `/files/**` 一律 `NetworkOnly`；导航 `NetworkFirst`（3s 超时回退 shell）。
- `registerType:'prompt'`，站内提示新版本，用户确认后 `skipWaiting`。
- `feature.pwa=false` 时前端 `unregister()` 并清缓存。
- 离线只读缓存页，禁用发帖并显示横幅。

## P6 实现（本地）

文档 meta 注入、`caches.default` 300s、sitemap/robots/manifest、PWA generateSW（新版本提示、API NetworkOnly）、静态 `_headers` CSP 与每日清理/对账已落地。远程绑定自定义域后需复测 Lighthouse 与真机离线。

## 部署

```jsonc
// wrangler.jsonc（要点）
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

- 部署策略：普通推送只跑 CI；明确推送 `v*` tag 才触发生产部署（`pnpm install` → `wrangler d1 migrations apply --remote` → typecheck/test → 必需 Secrets 校验 → build → `wrangler deploy --var ENVIRONMENT:production`）。迁移只增不删，API 先于前端。仓库已放 `ci.yml` / `deploy.yml` / `backup.yml` / `rollback.yml`（Spike 5 通过 actionlint，远程执行待凭据）。
- 预览：`wrangler versions upload` 生成同源预览 URL；OAuth 预览需把预览域加入回调白名单，或直接用 staging 自定义域。本地 `pnpm dev` 使用 `@cloudflare/vite-plugin`，D1/R2 状态固定到根目录 `.wrangler/state`，与 `pnpm db:migrate` 一致；`pnpm build` 输出 `apps/web/dist/client`（前端）与 `apps/web/dist/forum_hmilyd`（Worker）。
- 回滚：`wrangler rollback` 或控制台版本回滚；因为迁移 additive，整体回滚安全。
- 备份：GitHub Actions 每日 `wrangler d1 export --remote` → gzip → R2 备份桶，保留 7 份；D1 Time Travel 兜底。**不要用 Worker Cron 做备份**（10ms CPU 不够）。
  - **Spike 实测：D1 导出不支持 FTS5 虚拟表**（`cannot export databases with Virtual Tables (fts5)`），全量导出会直接失败。备份必须 `--no-schema --table <真实表...>` 并排除 `post_search`；恢复顺序为新库 apply migrations → 导入数据 → 重建搜索索引。`post_search` 是派生数据，允许重建。
  - 迁移前先停 `wrangler dev`：本地 dev 持有 D1 文件锁时执行 `d1 migrations apply --local` 会 `SQLITE_BUSY`。
- 域名：`forum.example.com` 绑 Worker custom domain；`cdn.example.com` 绑 R2；`mail.example.com` 用于 Resend（SPF/DKIM/DMARC）。
- OAuth：Google 一个应用，回调 `https://forum.example.com/api/auth/callback/google`；GitHub 本地/生产两个应用。本地 `localhost:8787` 与前端 `localhost:5173`（Vite 代理 `/api` 到 8787，避免跨域）。
- 环境变量/密钥见 `docs/01`。`.dev.vars` 不入库。

## 安全头

Worker 对文档与 API 返回：CSP（`script-src 'self' https://challenges.cloudflare.com`，`frame-src https://challenges.cloudflare.com`，`img-src 'self' https://cdn.example.com data:`）、`Referrer-Policy: strict-origin-when-cross-origin`（token 页面 `no-referrer`）、`X-Frame-Options: DENY`、`Permissions-Policy`、HSTS（Cloudflare 层）。
同源仍校验 `Origin`（写请求），并保留 `SameSite=Lax`。

## 免费额度预算（100 DAU / 日 500 浏览 / 日 50 帖）

| 资源 | 估算 | 额度 | 余量 |
|---|---|---|---|
| Worker 请求（API+文档） | 8–10k/日 | 100k/日 | ~90% |
| 静态资源 | 免费不限量 | — | — |
| D1 读 | ~40k 行/日 | 5M/日 | >99% |
| D1 写 | ~3k 行/日 | 100k/日 | ~97% |
| R2 | 2–3GB/月 | 10GB | 需清孤儿 |
| Resend | 10–30 封/日 | 100/日 | 主要瓶颈 |
| CPU | 1–4ms/请求 | 10ms | 中低 |

真正需要盯的是 **Resend 100 封/日** 与 **Better Auth 的 CPU 行为**。前者靠摘要/预算/退订，后者靠客户端派生密码。
