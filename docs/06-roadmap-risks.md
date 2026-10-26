# 06 路线、风险与测试策略

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

## 测试策略

- `pnpm typecheck`：四个 workspace 包
- `pnpm test`：共享契约、配置、统计
- `pnpm test:e2e:v2`：API 契约与分页
- `pnpm test:e2e:p1…p6`：认证、内容、编辑、通知、举报、SEO
- `pnpm test:p6:build`：PWA、构建产物、SW denylist

发布前至少：typecheck、unit、build、P6 构建检查；涉及 API/数据变更时跑对应 e2e。

## 已知边界

- Better Auth 在 D1 上不使用交互事务，依赖单语句/CAS。
- 迁移默认 additive；`0013_nav_dropdown.sql` 是唯一表重建例外。
- 生产 D1/R2/域名属于部署者，不进入上游仓库。
