# AGENTS.md — 开发、设计与运维规范

[English](AGENTS.md) | 简体中文

本文件是接手项目的 **agent 入口**。开始工作前按顺序阅读：

1. `AGENTS.md`（本文件）
2. `docs/README.md`（文档导读）
3. `docs/01-architecture.md`
4. `docs/02-data-api-config.md`
5. `docs/03-auth-permissions-email.md`
6. `docs/04-content-turnstile-search-upload.md`
7. `docs/05-frontend-theming-ops.md`
8. `docs/06-roadmap-risks.md`
9. `docs/07-design-spec.md`
10. `docs/08-configuration.md`
11. `docs/09-deployment.md`

设计已经定稿，不要重新讨论已决事项。发现文档与代码冲突时，**先修文档再改代码**；不要把规范重新塞回 `README.md`。

## 1. 产品与设计方向

Pineboard 是一个以主题和回复为中心的轻量论坛，视觉隐喻是“共享工作台 + 现场手册”：

- 信息密度高、列对齐、数字可扫读
- 1px 发丝线、少量圆角；不使用卡片阴影堆叠
- 深松绿 `#14513f` 为品牌底色，橙色 `#e2542c` 为强调色
- 全站统一 v2-* token，明暗双主题
- 不引入内容站/SaaS 仪表盘式布局，不做装饰性大图与营销区块

完整 token、页面规格、响应式断点与组件规则见 `docs/07-design-spec.md`。

### v0.2 已定版式

- 全站外框统一 `1180px` 居中
- 列表页：主栏 + `176px` 右栏（首页、版块、标签列表、标签详情、搜索）
- 正文页：1180 通排，无右栏（主题详情、发帖、编辑、修订历史）
- 个人中心/公开主页：1180，左侧导航 188
- 登录/注册：1180 两栏
- 楼层作者栏：`140px + minmax(0,1fr)`；移动端单列
- 错误页也使用 1180 外框

不要重新引入 `760/780/1024/1040` 的页面宽度分层。

## 2. 不可违反的技术约束

1. **单 Worker**：前端构建产物走 `assets.directory`，Worker 只处理 `/api/*` 与文档请求。不要引入 Pages、SSR 或第二套部署单元。
2. **密码链路**：浏览器端 PBKDF2 派生 → Better Auth 自定义 `password.hash/verify` 做 HMAC-SHA256(pepper)。不要在 Worker 里跑 scrypt/argon2。
3. **Cookie**：host-only，不设 `Domain`，`SameSite=Lax`，`Secure`，`HttpOnly`。不要开 `crossSubDomainCookies`。
4. **R2 上传**：预签名 PUT；禁 SVG/HTML；`complete` 必须 HEAD 复核大小与 MIME；直传需 magic bytes 校验。
5. **FTS5**：`post_search` 用 `post_uid UNINDEXED`，不要把 TEXT 主键当 rowid；`MATCH` 查询必须服务端转义。
6. **Turnstile 顺序**：参数校验 → 权限/邮箱验证 → 频率限制 → siteverify → 写库。校验失败必须让前端 `reset()`；无 Site Key 时前后端一致按未启用处理。
7. **邮件**：请求路径禁止 await Resend。验证/重置/提及用 `c.executionCtx.waitUntil()`；回复通知只写 `notifications`，由 Cron 摘要发送。发送函数内部 try/catch 并写 `email_logs`。
8. **编辑留痕**：一个 `db.batch()` 内完成快照 + 失效旧 FTS + 写新 FTS + CAS 更新主表，靠 `meta.changes` 判断 409。
9. **时间**：库内一律 `INTEGER` unix 秒（UTC），展示层用 `Intl` 按站点时区或浏览器时区。
10. **迁移**：默认只做 additive migration；部署顺序 `migrations → API → 前端`。
11. **配置单一入口**：CF 变量/Secrets 与 D1 `settings` 的边界见 `docs/08-configuration.md`；不要在代码里另造一套环境变量。
12. **认证状态**：注销冷静期用户可读、可显式撤销，但不能执行写操作或后台/版务操作。`requireAdmin` / `requireModerator` 必须同时要求 `status='active'`。

## 3. 已定架构决策

- 单 Worker + Static Assets；不做 Pages。
- 配置走 D1 `settings` 键值表 + 短缓存；不引入 KV。
- 集成密钥优先数据库（AES-GCM），环境变量只作兜底。
- Better Auth 使用 D1，事务关闭；依赖单语句/CAS，而不是交互事务。
- 证书登录、OAuth、审核队列、草稿箱属于后续范围。
- 只有主题可置顶；回复只能删除/隐藏。
- 通知邮件走 `notifications` + 5 分钟 Cron 摘要；验证/重置/提及按请求使用 `waitUntil`。
- 版本发布只由 `v*` tag 触发 Cloudflare 部署；普通 `main` push 只跑 CI。

## 4. 代码约定

- 单仓库 pnpm workspace：`apps/api`、`apps/web`、`packages/shared`、`packages/db`。
- 共享类型与 Zod 契约放 `packages/shared`；前后端不得各写一份（包括 API 信封）。
- 所有 API 返回 `{ ok, data, meta? }` 或 `{ ok:false, error:{ code, message, fields? } }`；错误码见 `docs/02`。
- 新配置项必须同步 `DEFAULTS`、Zod schema、后台分组与 `docs/02`/`docs/08`。
- 改数据库必须提交 migration，并在 `docs/02` 记录；手写迁移需说明原因。
- 新增 UI 优先复用 `v2-*` token、`ConfirmDialog`、`ErrorState`、`PaginationBar`、`BrandMark` 等既有组件。
- 不再使用 `window.confirm`；危险操作走共享 ConfirmDialog。
- 长标题、长主题名必须换行或省略，不能撑破网格。
- 所有写请求必须有 pending 状态，避免双击重复提交。

## 5. 迁移例外

`0013_nav_dropdown.sql` 是本项目 **唯一一次显式表重建**：SQLite 无法 `ALTER CHECK`，为给 `nav_items` 增加 `parent_id` 与 `dropdown` 类型，必须复制全表。

后续仍默认 additive；如确需重建表，必须在 migration 文件、`docs/02` 和 PR 说明中同时写明原因、数据复制方案和回滚方式。

## 6. 测试与发布

```bash
pnpm run setup   # 仅首次：交互式配置域名/D1/站名并生成 .dev.vars
pnpm dev
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e:v2
pnpm test:e2e:p1 ... p6
pnpm test:p6:build
```

发布流程：

```bash
# 正常开发
git push origin main          # 只跑 CI

# 发布
git tag v0.2.6
git push origin v0.2.6        # 触发 Deploy：migrations → 必需 Secrets 校验 → build → deploy → smoke
```

部署前检查：

```bash
pnpm check:deploy-env
wrangler secret list --format json
```

## 7. 文档规则

- `README.md` 只保留系统说明、功能、技术栈、仓库结构、快速开始和文档入口。
- 本文件保留 agent 工作流、设计方向、技术约束、发布规范。
- `docs/README.md` 是所有文档的导读，新增文档必须登记。
- 架构/API/权限/邮件/搜索/上传/配置/部署分别放 `docs/01`–`docs/09`。
- `docs/07` 是视觉唯一依据；`docs/08` 是配置唯一清单；`docs/09` 是开源部署步骤。
- 文档改动与代码改动同一 PR；不要只改代码。
- 文档默认英文；简体中文版本放在 `docs/zh-CN/`（根目录文件用 `*.zh-CN.md`），每页顶部通过语言切换链接互链。
- 两种语言在同一次提交中一起更新，不要让它们产生偏差。

## 8. 配置与开源边界

- Upstream 的 `wrangler.jsonc` 只含占位资源；真实部署配置由 `wrangler.site.jsonc` 生成，且不进入 Git。
- 下游只通过 GitHub Variables / Secrets / D1 settings / R2 对象提供站点差异，不修改 tracked 文件。
- 不要提交 `.dev.vars`、`wrangler.site.jsonc`、`.env*`、备份、生产数据库或上传对象。
- 开源发布前运行 `pnpm check:deploy-env`，并确认仓库历史没有 secret。
