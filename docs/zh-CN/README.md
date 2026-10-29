# 文档导读

[English](../README.md) | 简体中文

本目录是 Pineboard的全部设计、实现与运维文档。第一次接手先读根目录 [AGENTS.zh-CN.md](../../AGENTS.zh-CN.md)，再按下面路径阅读。

当前版本：`0.2.7`

## 推荐阅读路径

### 新贡献者 / Agent

1. [AGENTS.zh-CN.md](../../AGENTS.zh-CN.md)：设计方向、技术约束、代码与发布规范
2. 本文档导读
3. [01 架构](01-architecture.md)
4. [02 数据、API 与配置](02-data-api-config.md)
5. [03 认证、权限与邮件](03-auth-permissions-email.md)
6. [04 内容、Turnstile、搜索与上传](04-content-turnstile-search-upload.md)
7. [07 视觉与排版规范](07-design-spec.md)
8. [08 配置清单](08-configuration.md)

### 部署 / 运维

1. [09 部署指南](09-deployment.md)
2. [08 配置清单](08-configuration.md)
3. [01 架构](01-architecture.md)
4. [06 路线、风险与运维](06-roadmap-risks.md)

### 只想改界面

1. [07 视觉与排版规范](07-design-spec.md)
2. [05 前端、主题与运维](05-frontend-theming-ops.md)
3. [screenshots/](../screenshots/) 界面截图

### 只想接 API

1. [02 数据、API 与配置](02-data-api-config.md)
2. [03 认证、权限与邮件](03-auth-permissions-email.md)
3. `packages/shared/` 的 Zod 契约

## 文档清单

| 文档 | 内容 | 权威性 |
|---|---|---|
| [AGENTS.zh-CN.md](../../AGENTS.zh-CN.md) | agent 工作流、设计方向、技术约束、发布规范 | 开发规范唯一入口 |
| [01-architecture.md](01-architecture.md) | 单 Worker 部署、请求链路、目录、绑定、缓存 | 架构事实 |
| [02-data-api-config.md](02-data-api-config.md) | 数据表、索引、API、错误码、配置项 | 数据/API 契约 |
| [03-auth-permissions-email.md](03-auth-permissions-email.md) | 登录、权限矩阵、编辑留痕、通知与邮件 | 认证/权限事实 |
| [04-content-turnstile-search-upload.md](04-content-turnstile-search-upload.md) | Turnstile、FTS5、上传与安全 | 内容链路事实 |
| [05-frontend-theming-ops.md](05-frontend-theming-ops.md) | 前端路由、主题、PWA/SEO、历史运维说明 | 前端/运维补充 |
| [06-roadmap-risks.md](06-roadmap-risks.md) | 阶段记录、Spike、风险、测试与待办 | 历史/风险记录 |
| [07-design-spec.md](07-design-spec.md) | token、宽度、页面规格、响应式、交互 | 视觉唯一依据 |
| [08-configuration.md](08-configuration.md) | CF 变量/Secrets、D1 设置、优先级、tag 发布 | 配置唯一清单 |
| [09-deployment.md](09-deployment.md) | 开源复用的完整部署、初始化、备份、回滚 | 部署唯一入口 |
| [screenshots/](../screenshots/) | 界面截图 | 参考，非生产代码 |

## 按问题找文档

| 我要… | 看 |
|---|---|
| 本地跑起来 | [README 快速开始](../../README.zh-CN.md) + [09 部署指南](09-deployment.md) |
| 一键替换部署配置 | `pnpm run setup`，见 [09 部署指南](09-deployment.md) |
| 新建 Cloudflare 资源并部署 | [09 部署指南](09-deployment.md) |
| 知道哪些变量必须填 | [08 配置清单](08-configuration.md) |
| 知道哪些能在后台改 | [08 配置清单](08-configuration.md) + [09 部署指南](09-deployment.md) |
| 改页面宽度/颜色/间距 | [07 视觉规范](07-design-spec.md) |
| 加 API / 改表 | [02 数据与 API](02-data-api-config.md) |
| 改登录/权限/邮件 | [03 认证与权限](03-auth-permissions-email.md) |
| 改 Turnstile/搜索/上传 | [04 内容链路](04-content-turnstile-search-upload.md) |
| 查历史决策/风险 | [06 路线与风险](06-roadmap-risks.md) |
| 发布版本 | [AGENTS.zh-CN.md](../../AGENTS.zh-CN.md) + [09 部署指南](09-deployment.md) |

## 文档约定

- 架构、API、权限、配置、部署分别以 `01`–`09` 为准；旧文档中的过时描述应改，不要新增“第二套事实”。
- 设计数值只以 `07` 为准；配置项只以 `08` 为准；开源部署只以 `09` 为准。
- 代码与文档必须同一提交；新增文档必须登记到本页。
- 文档默认英文；简体中文版本在 `zh-CN/`（根目录文件用 `*.zh-CN.md`），两版需同步更新。
- `README.md` 只保留系统说明；规范与设计不要写回 README。
