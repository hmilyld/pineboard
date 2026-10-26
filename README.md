# Pineboard

一个面向工具、游戏与动手笔记的轻量论坛。前后端同源部署在单个 Cloudflare Worker 上，使用 D1、R2、Better Auth、Turnstile 与 Resend。

当前版本：`0.1.0`

## 功能

- 邮箱密码注册/登录、邮箱验证、密码重置、账户注销冷静期
- 版块、主题、楼中楼回复、标签、置顶、精华、锁定、移动
- 中文全文搜索、举报处理、通知与邮件摘要、退订
- 图片/压缩包上传（R2 预签名 + Worker 直传回退）
- 后台：站点设置、SEO、版块/标签/导航、用户与版主、举报、审计、集成配置、维护工具
- 文档 meta、sitemap、robots、PWA、响应式与深色模式

## 技术栈

- 前端：Vue 3、TypeScript、Vite、Tailwind CSS v4、shadcn-vue、Pinia、Vue Router、vite-plugin-pwa
- 后端：Cloudflare Workers、Hono、Drizzle ORM、D1、R2、Better Auth、Resend、Turnstile
- 部署：单 Worker + Workers Static Assets，Wrangler v4，GitHub Actions

## 仓库结构

```text
apps/api/           Hono Worker、路由、认证、邮件、搜索、上传、维护任务
apps/web/           Vue 前端、组件、页面、样式与 PWA
packages/shared/    共享类型、Zod 契约、配置 schema
packages/db/        Drizzle schema 与 D1 迁移
docs/               架构、API、权限、设计、配置、部署与运维文档
scripts/            e2e、构建检查、部署/备份辅助脚本
wrangler.jsonc      Worker、D1、R2、Assets、Cron 与路由配置
```

## 本地开发

```bash
pnpm install
pnpm setup                       # 交互式配置域名/D1，并生成本地 .dev.vars
pnpm db:migrate                  # 本地 D1 迁移（先停 dev）
pnpm dev                         # http://localhost:5173
```

常用检查：

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm check:deploy-env
```

端到端测试需要先启动 `pnpm dev`：

```bash
pnpm test:e2e:v2
pnpm test:e2e:p1   # p1…p6 同理
```

## 部署

生产部署使用 GitHub Actions 的 tag 工作流：

```bash
git tag v0.1.0
git push origin v0.1.0
```

普通 `main` push 只运行 CI，不打 tag 不会部署。首次部署、Cloudflare 资源创建、必须填写的变量/Secrets、后台可维护项、备份与回滚，见：

- [部署指南](docs/09-deployment.md)
- [配置清单](docs/08-configuration.md)

## 文档

完整文档导读：[docs/README.md](docs/README.md)

开发/设计/规范约束：[AGENTS.md](AGENTS.md)

## 状态

- 单元测试：32 项
- e2e：P1–P6 + v2 API 契约
- Cloudflare 资源与站点配置不进入仓库；部署见 `docs/09-deployment.md`

## 许可

MIT，版权主体 hmilyld。见 [LICENSE](LICENSE)。
