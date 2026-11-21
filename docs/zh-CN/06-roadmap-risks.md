# 06 路线、风险与测试策略

[English](../06-roadmap-risks.md) | 简体中文

## 路线

Pineboard 以“可自托管的轻量讨论板”为范围，核心路线：

1. 认证、账户、权限、通知与邮件
2. 主题/回复/标签/搜索/举报/管理
3. R2 上传、PWA、SEO、后台运营
4. 可观测性、备份恢复与开源部署体验

不在核心范围：OAuth、审核队列、草稿箱、服务端全文检索外部服务、移动原生客户端。

## 主要风险

| 风险 | 影响 | 应对 |
|---|---|---|
| D1 单语句限制 | 批量写入/恢复失败 | 分片、CAS、避免交互事务 |
| FTS5 与 D1 导出 | 备份/恢复复杂 | 备份跳过 `post_search`，恢复后重建 |
| Resend 额度/退信 | 邮件延迟或停止 | 摘要、预算、抑制列表、失败日志 |
| Turnstile 配置缺失 | 注册/发帖被锁死 | 无 Site Key 时前后端一致跳过，健康检查标记 |
| R2 CORS/自定义域 | 上传或图片读取失败 | Worker 直传回退、`/files/*`、CDN 可选 |
| Fork 配置漂移 | 无法跟随上游 | 所有站点配置走 Variables/Secrets/D1，不修改 tracked 文件 |
| 仅开发期的 `esbuild` 公告（`better-auth → drizzle-kit → @esbuild-kit`） | 只影响本地工具链，不在生产运行时暴露 | 跟踪上游；每次发布前重跑 `pnpm audit --prod` |

## 测试策略

- `pnpm lint` 与 `pnpm format:check`
- `pnpm typecheck`：四个 workspace 包
- `pnpm test:coverage`：单元测试 + 覆盖率棘轮（先报告，随测试补充再抬高）
- `pnpm test:e2e:v2`：API 契约与分页
- `pnpm test:e2e:p1…p6` 与 `pnpm test:e2e:review`：认证、内容、编辑、通知、举报、SEO 与审核
- `pnpm test:p6:build`：PWA、构建产物、SW denylist

发布前至少：lint、格式化、typecheck、单元测试、构建与 P6 构建检查；涉及 API/数据变更时跑对应 e2e。CI 会在每个 PR 上执行上述全部检查。

## 已知边界

- Better Auth 在 D1 上不使用交互事务，依赖单语句/CAS。
- 迁移默认 additive；`0013_nav_dropdown.sql` 是唯一表重建例外。
- 生产 D1/R2/域名属于部署者，不进入上游仓库。
