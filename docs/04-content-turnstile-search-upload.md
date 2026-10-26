# 04 内容链路：Turnstile、搜索、上传

## Turnstile

- Managed 模式；前端 Vue 组件固定 `action`：`signup` / `topic_create` / `post_create`。
- 默认 `appearance: "interaction-only"`：没有挑战时组件不占高度、不打扰用户；Cloudflare 需要确认时才原地出现。
- `error-callback` 触发或提交时仍无 token 时，切换到 `appearance: "always"` 重新渲染，让用户手动完成验证；成功后 token 通过 `callback` 回传。
- 提交时若已有 token 直接使用；任何失败后必须 `reset()`，否则重试可能 `timeout-or-duplicate`。
- 服务端顺序固定：**载荷校验 → 权限/邮箱验证 → 写频率限制 → siteverify → 写库**。参数错误不能先消耗 token。
- siteverify 携带 `secret`、`response`、`remoteip = CF-Connecting-IP`，5s 超时，并校验返回的 `action` 与 `hostname`。hostname 是挂载 widget 的页面域（`forum.example.com`），不是 API 域——本项目同源，二者一致。
- 错误映射：`invalid-input-response` / `timeout-or-duplicate` → 400 `captcha_failed`；`internal-error` / 网络超时 → 503 `captcha_unavailable`，保留编辑器内容。
- 总开关 `feature.turnstile`；关闭时跳过校验。**没有 Site Key 时前后端一致按“未启用”处理**：`/api/site` 下发 `feature.turnstile=false`，后端跳过 siteverify；`/api/health.turnstileConfigured` 用于监控。Site Key 存在但 Secret 缺失时返回 `captcha_unavailable`。注册入口也走同一套。
- E2E 用官方测试 key（always-pass / always-fail），不要拿生产 key 跑自动化。

## 中文搜索

P5 已实现：FTS5 迁移、发帖/回复/编辑/删除 batch 双写、`/api/search`、单字 LIKE 回退、管理员 reindex。部署后需执行一次 reindex 回填历史帖子。

FTS5 的 `unicode61` 不切分中文，整句会变成一个 token。方案：写入时生成 bigram 串。

```
"游戏攻略分享" → "游戏 戏攻 攻略 略分 分享"
"Elden Ring 攻略" → "elden ring 攻略"
```

- 规范化：NFKC、小写、去零宽字符、剥 Markdown 标记、标点转空格。
- 正文与标题都进 `post_search`；`post_uid` / `topic_id` 用 `UNINDEXED`。
- 查询同样 bigram 化，服务端拼成短语查询；**必须转义双引号**，禁止原样拼 `MATCH`。
- 单字查询回退 `LIKE`（带 `ESCAPE`），限制结果数。
- 排序：相关度用 `bm25()`，或按时间。
- 查询侧 join `posts/topics` 只返回 `published`，避免索引滞后泄露隐藏/删除内容。
- 管理员可全量重建；每周抽样 50 条比对漂移。
- `feature.search=false` 时前端隐藏入口，接口返回 404。

## Markdown

- 渲染只在浏览器：`markdown-it` + `DOMPurify`，禁止原始 HTML；外链 `rel="noopener noreferrer"`；图片懒加载。
- `feature.markdown=false` 时按纯文本渲染，`white-space: pre-wrap`。
- 服务端只存 `contentMd` 与纯文本 `contentText`（截断摘要），不做 HTML 渲染。
- @提及解析前先剥代码块、行内代码与链接；正则 `(?<![\w@])@([a-z0-9_-]{3,20})`；每帖最多 5 人；只通知存在且能看到该主题的用户；自己 @ 自己不通知。

## R2 上传

**类型白名单**：

- 图片：`image/jpeg`、`image/png`、`image/webp`、`image/gif`、`image/avif`；扩展名由 MIME 统一推导。
- 附件：只允许压缩包 ZIP/RAR/7Z；PDF 不再作为附件类型。
- **禁止 SVG/HTML**；所有对象 key 由服务端生成，不信任原始文件名。

**预签名直传**：

1. `POST /api/uploads/sign`：登录 + 邮箱已验证 + `feature.uploads` → 按类型/大小/日配额校验 → 生成 `uploads/<userId>/<kind>/<yyyyMM>/<random>.<ext>` → Worker 内用 WebCrypto 做 SigV4 预签名 PUT，10 分钟过期。`X-Amz-SignedHeaders` 包含 `content-length;content-type;host`，把大小与 MIME 一并绑定。
2. 浏览器直接 `PUT` 到 `https://<account>.r2.cloudflarestorage.com/<bucket>/<key>`。R2 bucket 需要配置 CORS：允许站点来源的 `PUT` 与 `Content-Type` 请求头。
3. `POST /api/uploads/complete`：对 key 做 `HEAD`，校验归属前缀、真实大小、MIME 与声明一致；通过后返回 CDN URL。
4. 浏览器自动发送 `Content-Length`；签名已绑定声明大小。`complete` 再做 HEAD 复核，日配额与孤儿清理兜底。

**Worker 直传回退**：

- 当 R2 S3 凭据缺失、bucket 未配 CORS 或本地 Miniflare 环境无法跨域 PUT 时，前端自动回退 `POST /api/uploads/direct`。
- 直传路径通过 `BUCKET.put` 写入，并校验 magic bytes（JPEG/PNG/WebP/GIF/AVIF、ZIP/RAR/7Z），随后 `HEAD` 复核。
- 每日维护一次收集 `posts.content_md`、`post_revisions.content_md`、`user.avatar_key`、`settings.value_json` 中的 key 集合，再遍历 R2；只删除超过 `upload.orphanTtlHours` 且未被引用的对象，单轮最多 200 个。
- Worker 直传使用流式读取，超过 25MB 或 `fileMaxMb` 时立即中断，避免 `arrayBuffer()` 打满内存。
- 本地开发返回 `/files/<key>`，由 Worker 读取 R2 binding；生产优先使用配置的 CDN URL。`/files/*` 需要在 `run_worker_first` 中。

**开关与大小**：

- 后台「站点设置 → 注册与写入」提供 `feature.uploads` 开关；关闭后编辑器隐藏上传按钮，API 返回 403。
- 默认图片 5MB、附件 10MB、每用户每日 20 次；来自 `upload` 配置组。
- 编辑器的图片/附件按钮只在登录且允许上传时出现；图片插入 `![name](url)`，附件插入 `[name](url)`。

**安全**：

- 非图片设置 `Content-Disposition: attachment`；响应带 `X-Content-Type-Options: nosniff`。
- key 随机且按用户隔离；bucket 关闭目录列举。
- CDN 使用独立子域，session cookie host-only，不会发往 `cdn.`。
- CSP 允许 `https://*.r2.cloudflarestorage.com` 连接与 HTTPS 图片；不再只限固定 CDN 域。

## 举报（v1）

- 登录用户可举报主题/回复；同一目标同一时间只允许一条 `pending` 举报（部分唯一索引）。
- 版主在后台看到列表，可 `resolved` 或 `dismissed`；处理结果写审计，举报人收到站内通知。
- 举报不做自动下架，避免被滥用；版主手动隐藏/删除。
