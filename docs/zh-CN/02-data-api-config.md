# 02 数据模型、API 与配置

[English](../02-data-api-config.md) | 简体中文

## 约定

- 主键 `TEXT` ULID；时间 `INTEGER` unix 秒（UTC）；软删除用 `status + deleted_at`。
- 外键 `ON DELETE RESTRICT`；所有 status 用 `CHECK` 限定枚举。
- 计数列（`reply_count`、`like_count`、`usage_count`）与主写入同 batch 更新，每日对账。
- `posts` 统一承载首帖与回复：首帖 `is_first=1` 且 `title` 有值，主题标题不存在 `topics` 表。

## 认证表（Better Auth 托管 + 扩展）

| 表 | 关键字段 |
|---|---|
| `user` | id, name, email(unique, **COLLATE NOCASE**；Drizzle schema 无 collate API，迁移文件为准), emailVerified, image, **username(unique)**, **role**(user/moderator/admin), **status**(active/suspended/deleting/deleted), bio, avatarKey, timezone, lastSeenAt, deletedAt, createdAt, updatedAt |
| `session` | id, userId, token, expiresAt, ipAddress, userAgent；索引 userId、expiresAt |
| `account` | id, userId, providerId(credential/google/github), accountId, password, scope |
| `verification` | id, identifier, value, expiresAt |
| `rateLimit` | id, key(unique), count, lastRequest（Better Auth `storage='database'`；`lastRequest` 由库内写毫秒，属 unix 秒约定的唯一例外） |

## 论坛表

| 表 | 关键字段 |
|---|---|
| `categories` | id, slug(unique), name, description, color(#rrggbb), sortOrder, isVisible, createdAt |
| `category_moderators` | categoryId, userId（联合主键） |
| `nav_items` | id, label, href, kind(link/categories/dropdown), parentId, sortOrder, isVisible, openInNewTab, createdAt, updatedAt；`dropdown` 子项通过 `parentId` 组成树，`categories` 项渲染为版块下拉 |
| `tags` | id, slug(unique), name, description, color, usageCount(冗余，仅保留兼容), status, createdAt |
| `topic_tags` | topicId, tagId（联合主键）；`tag_id` 单独索引 |
| `topics` | id, categoryId, authorId, firstPostId, status(published/hidden/deleted；预留 pending/rejected), pinLevel(0/1/2), pinOrder, isLocked, isDigest, replyCount, likeCount, viewCount, lastPostAt, lastPostUserId, createdAt, updatedAt, deletedAt, deletedBy |
| `posts` | id, topicId, authorId, parentPostId, floor, isFirst, title, contentMd, contentText, status(published/hidden/deleted；预留 pending/rejected), likeCount, version, editCount, editedAt, createdAt, updatedAt, deletedAt, deletedBy |
| `post_revisions` | id, topicId, postId, version, title, contentMd, action(edit/delete/restore), editorId, reason, createdAt；`UNIQUE(postId, version)` |
| `post_likes` | userId, postId（联合主键）, createdAt |
| `bookmarks` | userId, topicId（联合主键）, createdAt |
| `reports` | id, reporterId, targetType(topic/post), targetId, **categoryId/topicId/postId/targetTitle/targetSnippet 快照**, reasonCode, detail, status(pending/resolved/dismissed), handledBy, handledAt, resolutionNote, createdAt；`UNIQUE(reporterId,targetType,targetId) WHERE status='pending'` |
| `notifications` | id, userId, type(topic_reply/post_reply/mention/moderation/system), actorId, topicId, postId, title, snippet, readAt, emailStatus(pending/sent/skipped/failed), emailBatchKey, createdAt |
| `notification_preferences` | userId, category（联合主键）, emailEnabled, updatedAt |
| `email_unsubscribe_tokens` | id, userId, category, tokenHash(unique), version, expiresAt, usedAt |
| `email_logs` | id, userId, toEmail, category, template, status(queued/sent/failed/skipped), providerId, errorCode, errorMessage, attempts, notificationId, createdAt, sentAt |
| `audit_logs` | id, actorId, action, targetType, targetId, metaJson, ipHash, createdAt |
| `settings` | key(PK), valueJson, groupName, updatedAt, updatedBy, version |
| `rate_limits` | key, windowStart（联合主键）, count |

v1.1 预留：`drafts`、`sensitive_words`；`status` 枚举已预留 `pending/rejected`，无需改主表。

> 上传当前不落 `upload_intents`/`attachments` 表：`sign` 校验后直接返回预签名 URL，`complete` 通过 R2 `HEAD` 复核并返回 CDN URL；Worker 直传回退校验 magic bytes。若后续需要配额核销、附件楼层绑定或孤儿清理，再补这两张表。

初始迁移会幂等插入一个「综合讨论」版块和「攻略/求助/资讯」标签，便于新站直接使用；用户内容不随迁移写入。迁移 `0009` 增加 `categories.color` 与 `nav_items`，并幂等写入「首页 / 版块 / 标签」默认导航；`0010` 增加举报快照与索引，`0011` 增加配置版本行，`0012` 增加 `email_logs.to_email` 索引，`0013` 重建 `nav_items` 增加 `parent_id` 与 `dropdown` 类型（SQLite CHECK 无法 ALTER，这是 additive 原则的显式例外）；`0014` 清除此前被强制开启的管理通知邮件偏好，使所有邮件类型默认关闭（一次性数据归一，不涉及用户内容）。手写迁移 `0003` 不在 drizzle journal 中，`wrangler d1 migrations apply` 仍会执行。

## 检索表

```sql
CREATE VIRTUAL TABLE post_search USING fts5(
  post_uid UNINDEXED,
  topic_id UNINDEXED,
  title,
  tokens,
  tokenize = 'unicode61 remove_diacritics 2'
);
```

- 写入前把正文规范化为 bigram 串：`游戏攻略 → 游戏 戏攻 攻略`，英文单词整体保留。
- 增删改按 `post_uid`；查询由服务端拼词项并转义双引号，禁止原样拼 `MATCH`。
- 查询侧 join `posts/topics` 过滤 `published`，防止索引滞后泄露隐藏内容。

## 索引

```
topics (status, pinLevel DESC, pinOrder, lastPostAt DESC)
topics (status, categoryId, pinLevel DESC, lastPostAt DESC)
topics (authorId, createdAt DESC)
topics (status, isDigest, lastPostAt DESC)
posts (topicId, status, floor) UNIQUE(topicId, floor)
posts (authorId, createdAt DESC)
posts (parentPostId)
post_revisions (postId, version DESC)
post_likes (postId)
bookmarks (userId, createdAt DESC)
notifications (userId, readAt, createdAt DESC)
notifications (emailStatus, createdAt)
email_logs (createdAt), (status, createdAt), (toEmail)
reports (status, createdAt), (categoryId, status, createdAt)
topic_tags (tagId)
audit_logs (targetType, targetId), (createdAt)
```

## API

统一返回 `{ ok:true, data, meta? }`；错误 `{ ok:false, error:{ code, message, fields? } }`。
错误码：`auth_required / email_unverified / forbidden / not_found / gone / validation_error / version_conflict / edit_window_expired / edit_locked / captcha_failed / captcha_unavailable / rate_limited / conflict / maintenance / internal_error`。

### 认证（Better Auth 挂载 `/api/auth/*`）

v1 只启用邮箱密码；`sign-in/social`、`callback/:provider` 与 Google/GitHub secrets 预留给 v1.1。

`sign-up/email`（Turnstile）、`sign-in/email`、`sign-in/social`、`callback/:provider`、`verify-email`、`send-verification-email`、`request-password-reset`（旧文档写作 forget-password）、`reset-password`、`change-password`、`list-sessions`、`revoke-session`、`sign-out`。

Spike 实测（Better Auth 1.7.12）：验证邮件与重置邮件里的 token 是自包含 JWT，可不在 `verification` 持久化；重置 token 会以 `reset-password:<token>` 落 `verification`。

### 公共读

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/site` | 公开配置（含 `site.announcement`），`s-maxage=60` |
| GET | `/api/site/stats` | 今日发帖 / 主题 / 回复 / 成员，`s-maxage=60` |
| GET | `/api/nav` | 可见顶部导航项（`link` / `categories`），`no-store` |
| GET | `/api/me` | 当前用户摘要，未登录 401，`no-store` |
| GET | `/api/me/optional` | 当前用户摘要；未登录 200 `{user:null,permissions:null}`，用于首屏探测 |
| GET | `/api/categories`、`/api/categories/:slug` | 版块 |
| GET | `/api/topics` | `category,tag,sort=latest\|new\|hot,digest=1,page,perPage`；`lastPostUser`,`isDigest` |
| GET | `/api/topics/:id` | 主题 + 首帖 + 标签 + viewerPermissions |
| GET | `/api/topics/:id/posts` | `page`/`perPage`/`onlyOp=1`，20 楼/页；首帖不在 items，`total` 含首帖；`onlyOp` 的 total 只计首帖+楼主回复；游标模式同样排除首帖 |
| GET | `/api/tags`、`/api/tags/:slug` | 标签、标签详情（三项统计） |
| GET | `/api/search` | `q,page,perPage,sort=relevance\|latest`；帖子级结果 |
| GET | `/api/users/:username`、`/topics`、`/replies` | 用户主页（含 topicCount/replyCount/likeCount/bookmarkCount） |
| GET | `/api/health` | 版本、配置版本、DB/R2 连通；R2 探测缓存 30s；`turnstileConfigured` 表示 Site Key + Secret 均已配置 |

### 写入

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/api/topics` | 已验证 + Turnstile | `{categoryId,title,contentMd,tagIds}` |
| PATCH | `/api/topics/:id` | 作者/版主/管理员 | 带 `version`，409 冲突 |
| DELETE | `/api/topics/:id` | 作者(受配置)/版主/管理员 | 软删除 |
| POST | `/api/topics/:id/view` | 公开 | 按 `topic + IP hash` 5 分钟去重，同一窗口只 +1 |
| POST | `/api/topics/:id/posts` | 已验证 + Turnstile | `{contentMd,parentPostId?}`；`parentPostId` 仅表示楼层回复（最多 2 层）；引用不传 `parentPostId`，按普通新楼层写入 |
| PATCH/DELETE | `/api/posts/:id` | 作者/版主/管理员 | 同上 |
| POST | `/api/posts/:id/like`、`/api/topics/:id/bookmark` | 幂等切换；点赞为单条 INSERT OR IGNORE + 计数重算 |
| GET | `/api/topics/:id/revisions?postId=` | 按可见性配置（P3 已实现 public/author/staff） |
| POST | `/api/reports` | 登录 | 24h 同目标去重 |
| POST | `/api/mod/topics/:id/digest` | 版主/管理员 | `{isDigest}`，精华 |
| POST | `/api/uploads/sign`、`/api/uploads/complete`、`/api/uploads/direct` | 已验证 + `feature.uploads` | 预签名直传 / HEAD 复核 / Worker 回退直传；图片仅 JPG/PNG/WebP/GIF/AVIF，附件仅 ZIP/RAR/7Z |
| GET | `/files/*` | 公开 | 本地/无 CDN 时的 R2 对象回退读取 |

### 个人中心与管理

`GET /api/me/summary|topics|replies|bookmarks|notifications`、`POST /api/me/notifications/read`、`GET|PATCH /api/me/preferences`、`POST /api/me/delete|delete/cancel|export`、`POST /api/unsubscribe`、`GET /api/unsubscribe/preview`。头像/资料编辑端点尚未实现。

版主：`GET /api/mod/reports`、`POST /api/mod/reports/:id/resolve`、`POST /api/mod/topics/:id/pin|lock|move`。
管理员运维：`GET /api/mod/audit`、`POST /api/mod/posts/:id/restore`；后台「审计日志」页可直接恢复删除的主题/回复。
管理员：`GET /api/admin/overview`、`settings`、`emails`、`search/reindex`、`maintenance/daily`、`users`。

用户管理（管理员）：`GET /api/admin/users?q=&status=&role=&page=`（20/页），`PATCH /api/admin/users/:id`（角色），`POST /api/admin/users/:id/suspend|unsuspend`；禁止操作自己，禁止降级/封禁最后一个活跃管理员，封禁会删除该用户全部 session 并写 `user.suspend` 审计。

版块维护（管理员）：`GET|POST /api/admin/categories`、`PATCH|DELETE /api/admin/categories/:id`、`PATCH /api/admin/categories/reorder`。删除前检查版块下是否仍有主题，有主题返回 `conflict`。

版主分配（管理员）：`POST /api/admin/categories/:id/moderators`（`{username}`，也接受邮箱）、`DELETE /api/admin/categories/:id/moderators/:userId`。添加普通用户时自动把 `user.role` 提升为 `moderator`；移除最后一个版块映射后自动回退为 `user`；管理员拥有全站权限，拒绝分配。

标签维护（管理员）：`GET|POST /api/admin/tags`、`PATCH|DELETE /api/admin/tags/:id`。支持名称、slug、说明、颜色与 `active/hidden/merged` 状态；仍被主题引用的标签禁止删除，返回 `conflict`。

导航维护（管理员）：`GET|POST /api/admin/nav`、`PATCH|DELETE /api/admin/nav/:id`、`PATCH /api/admin/nav/reorder`；公开读 `GET /api/nav`（`no-store`，只返回可见项）。

集成配置（管理员）：`GET|PATCH /api/admin/integrations`、`POST /api/admin/integrations/test`。PATCH 同时接受 `version`、非密钥 `integration.cloudflare` 与 `secrets.{resendApiKey,resendWebhookSecret,turnstileSecret,r2AccessKeyId,r2SecretAccessKey}`；写入非密钥需带当前 `version`，响应返回新 `version`；密钥写入后不回显，只返回 `configured/source/updatedAt`。

v2 通知额外返回 `postFloor`，前端据此拼 `?page=N#post-F`；首页/版块/标签/用户列表均返回 `lastPostUser`（可能为 null）。

举报列表按 `reports.category_id` 在 SQL 侧过滤并用 `LIMIT/OFFSET` 直接分页，返回 `total/totalPages`，后台页面已接页码；举报创建时写入目标快照，目标被删除后列表仍展示快照，处理接口允许关闭并审计 `contentRemoved`，不再返回 410。移动主题时同步更新待处理举报的 `category_id`。标签的公开/后台使用数是 `topic_tags JOIN topics(published)` 的实时聚合，`tags.usage_count` 只作为兼容冗余。

## 配置项

`settings` 存覆盖值，代码内 `DEFAULTS` 提供全量默认；读取深合并，写时 Zod 校验，读时安全解析（坏值回退默认并告警）。普通域 45s 缓存，安全域 5s。`PATCH /api/admin/settings` 必须带 `{version, patch}`；版本推进使用 `settings('__config_version')` 行上的单条条件 `UPDATE version = version + 1 WHERE version = ?`，不匹配返回 409 `version_conflict`，避免多 isolate TOCTOU。

| 域 | 键与默认值 |
|---|---|
| site | name=Pineboard；tagline=轻量、专注讨论的社区；url；description；keywords；logoKey；faviconKey；ogImageKey；timezone=Asia/Shanghai；language=`zh-CN` \| `en`（全站唯一界面语言，前台与后台一致，访客不能切换）；icp；announcement={id,enabled,text,href} |
| seo | titleTemplate=`{title} · {siteName}`；homeTitle；description；noindex=false；topicsPerPage=20（5–50）；postsPerPage=20（5–50）；sitemapEnabled=true |
| account | registrationOpen=true；allowUnverifiedLogin=true；requireVerificationForWrite=true；passwordMinLength=8；usernameMin=3；usernameMax=20；sessionDays=30；deletionGraceDays=7 |
| edit | windowUserMinutes=60；windowModeratorMinutes=0；allowStaffEditOthers=true；lockAfterReply=false；allowSelfDelete=true；historyVisibility=author；keepRevisions=20；requireReason=false |
| mail | enabled=true；fromName；fromAddress=no-reply@mail.example.com；replyTo；notifyTopicReply=true；notifyPostReply=true；notifyMention=true；notifyModeration=true；includeUnsubscribe=true；dailyBudget=80；userDailyCap=10；digestWindowMinutes=10；verificationTtlMinutes=60；resetTtlMinutes=30；unsubscribeTokenDays=180 |
| feature | turnstile=true；pwa=true；markdown=true；search=true；uploads=true；reports=true；guestRead=true |
| maintenance | enabled=false；message（运营文案，原样显示）；allowAdmin=true |
| upload | imageMaxMb=5；fileMaxMb=10；userDailyCount=20；orphanTtlHours=24（文件类型由路由白名单校验：图片 JPG/PNG/WebP/GIF/AVIF，附件 ZIP/RAR/7Z） |
| security | postMinIntervalSeconds=30；newUserDailyPosts=10；mentionMaxPerPost=5；reportDailyLimit=10；signupPerHour=5（Turnstile 前的按 IP 固定窗口） |
| integration | cloudflare.accountId=""；cloudflare.r2Bucket=""；cloudflare.cdnUrl=""；cloudflare.turnstileSiteKey=""（空值回退 Worker 变量） |
| theme | layout=classic；tokens={}；darkMode=system |

### 集成密钥（加密存储）

- 非密钥标识存 `settings.integration.*`，走普通配置版本与 45s 缓存。
- 密钥存 `settings` 的 `secrets.<name>`（`group_name='secrets'`），值为 AES-GCM 密文（密钥由 `BETTER_AUTH_SECRET` 派生），后台只看到状态。
- 运行时优先数据库密钥，其次 Worker secret；因此轮换 Resend/Turnstile/R2 凭据无需重新部署。
- Turnstile Site Key 从 `integration.cloudflare.turnstileSiteKey` → `TURNSTILE_SITE_KEY` 解析；Secret 从 `secrets.turnstileSecret` → `TURNSTILE_SECRET` 解析。
- `/api/site` 仍只暴露公开 Site Key，不返回任何密钥或 `integration` 组。

## 内容限制

正文 ≤32KB；标签 ≤5；附件 ≤10；单请求体 ≤100KB；用户名单 `[a-z0-9_-]{3,20}` 且过保留字黑名单。楼层用单语句 `COALESCE(MAX(floor),0)+1` 取号，`UNIQUE(topicId,floor)`。
