# 02 Data model, API and configuration

English | [简体中文](zh-CN/02-data-api-config.md)

## Conventions

- Primary keys are `TEXT` ULIDs; times are `INTEGER` unix seconds (UTC); soft deletes use `status + deleted_at`.
- Foreign keys use `ON DELETE RESTRICT`; every status is constrained to an enum by `CHECK`.
- Counter columns (`reply_count`, `like_count`, `usage_count`) are updated in the same batch as the primary write and reconciled daily.
- `posts` carries both first posts and replies: a first post has `is_first=1` and a non-null `title`; topic titles do not live in a `topics` table.

## Authentication tables (Better Auth managed + extended)

| Table | Key fields |
|---|---|
| `user` | id, name, email(unique, **COLLATE NOCASE**; the Drizzle schema has no collate API, the migration file is authoritative), emailVerified, image, **username(unique)**, **role**(user/moderator/admin), **status**(active/suspended/deleting/deleted), bio, avatarKey, timezone, lastSeenAt, deletedAt, createdAt, updatedAt |
| `session` | id, userId, token, expiresAt, ipAddress, userAgent; indexes on userId, expiresAt |
| `account` | id, userId, providerId(credential/google/github), accountId, password, scope |
| `verification` | id, identifier, value, expiresAt |
| `rateLimit` | id, key(unique), count, lastRequest (Better Auth `storage='database'`; `lastRequest` is written in milliseconds by the library and is the only exception to the unix-seconds convention) |

## Forum tables

| Table | Key fields |
|---|---|
| `categories` | id, slug(unique), name, description, color(#rrggbb), sortOrder, isVisible, createdAt |
| `category_moderators` | categoryId, userId (composite primary key) |
| `nav_items` | id, label, href, kind(link/categories/dropdown), parentId, sortOrder, isVisible, openInNewTab, createdAt, updatedAt; `dropdown` children form a tree via `parentId`, `categories` items render as a category dropdown |
| `tags` | id, slug(unique), name, description, color, usageCount(redundant, kept for compatibility only), status, createdAt |
| `topic_tags` | topicId, tagId (composite primary key); `tag_id` is indexed separately |
| `topics` | id, categoryId, authorId, firstPostId, status(published/hidden/deleted; pending/rejected reserved), pinLevel(0/1/2), pinOrder, isLocked, isDigest, replyCount, likeCount, viewCount, lastPostAt, lastPostUserId, createdAt, updatedAt, deletedAt, deletedBy |
| `posts` | id, topicId, authorId, parentPostId, floor, isFirst, title, contentMd, contentText, status(published/hidden/deleted; pending/rejected reserved), likeCount, version, editCount, editedAt, createdAt, updatedAt, deletedAt, deletedBy |
| `post_revisions` | id, topicId, postId, version, title, contentMd, action(edit/delete/restore), editorId, reason, createdAt; `UNIQUE(postId, version)` |
| `post_likes` | userId, postId (composite primary key), createdAt |
| `bookmarks` | userId, topicId (composite primary key), createdAt |
| `reports` | id, reporterId, targetType(topic/post), targetId, **categoryId/topicId/postId/targetTitle/targetSnippet snapshot**, reasonCode, detail, status(pending/resolved/dismissed), handledBy, handledAt, resolutionNote, createdAt; `UNIQUE(reporterId,targetType,targetId) WHERE status='pending'` |
| `notifications` | id, userId, type(topic_reply/post_reply/mention/moderation/system), actorId, topicId, postId, title, snippet, readAt, emailStatus(pending/sent/skipped/failed), emailBatchKey, createdAt |
| `notification_preferences` | userId, category (composite primary key), emailEnabled, updatedAt |
| `email_unsubscribe_tokens` | id, userId, category, tokenHash(unique), version, expiresAt, usedAt |
| `email_logs` | id, userId, toEmail, category, template, status(queued/sent/failed/skipped), providerId, errorCode, errorMessage, attempts, notificationId, createdAt, sentAt |
| `audit_logs` | id, actorId, action, targetType, targetId, metaJson, ipHash, createdAt |
| `settings` | key(PK), valueJson, groupName, updatedAt, updatedBy, version |
| `rate_limits` | key, windowStart (composite primary key), count |

Reserved for v1.1: `drafts`, `sensitive_words`; the `status` enums already reserve `pending/rejected`, so the main tables need no change.

> Uploads currently write no `upload_intents`/`attachments` tables: `sign` validates and returns a presigned URL directly, `complete` re-checks via R2 `HEAD` and returns the CDN URL, and the Worker direct-upload fallback validates magic bytes. If quota accounting, floor-level attachment binding or orphan cleanup is needed later, add those two tables then.

The initial migration idempotently inserts one "General Discussion" category and the "Guide/Help/News" tags so a new site is usable right away; user content is never written by migrations. Migration `0009` adds `categories.color` and `nav_items` and idempotently writes the default "Home / Categories / Tags" navigation; `0010` adds report snapshots and indexes, `0011` adds the configuration version row, `0012` adds the `email_logs.to_email` index, and `0013` rebuilds `nav_items` to add `parent_id` and the `dropdown` type (SQLite `CHECK` cannot be altered, an explicit exception to the additive principle); `0014` clears the moderation email preference that was previously forced on, so every email category starts opted out (one-time data normalization, not user content). The hand-written migration `0003` is not in the drizzle journal, yet `wrangler d1 migrations apply` still runs it.

## Search table

```sql
CREATE VIRTUAL TABLE post_search USING fts5(
  post_uid UNINDEXED,
  topic_id UNINDEXED,
  title,
  tokens,
  tokenize = 'unicode61 remove_diacritics 2'
);
```

- Before writing, normalize the body into a bigram string: `游戏攻略 → 游戏 戏攻 攻略`, while English words are kept whole.
- Insert, update and delete by `post_uid`; queries have the server build the terms and escape double quotes, building `MATCH` from raw input is forbidden.
- The query side joins `posts/topics` and filters on `published`, so index lag cannot leak hidden content.

## Indexes

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

Uniform response `{ ok:true, data, meta? }`; errors `{ ok:false, error:{ code, message, fields? } }`.
Error codes: `auth_required / email_unverified / forbidden / not_found / gone / validation_error / version_conflict / edit_window_expired / edit_locked / captcha_failed / captcha_unavailable / rate_limited / conflict / maintenance / internal_error`.

### Authentication (Better Auth mounted at `/api/auth/*`)

v1 enables email + password only; `sign-in/social`, `callback/:provider` and the Google/GitHub secrets are reserved for v1.1.

`sign-up/email` (Turnstile), `sign-in/email`, `sign-in/social`, `callback/:provider`, `verify-email`, `send-verification-email`, `request-password-reset` (written as forget-password in older docs), `reset-password`, `change-password`, `list-sessions`, `revoke-session`, `sign-out`.

Spike measurements (Better Auth 1.7.12): the tokens in verification and reset emails are self-contained JWTs and need not be persisted in `verification`; a reset token is stored in `verification` as `reset-password:<token>`.

### Public reads

| Method | Path | Description |
|---|---|---|
| GET | `/api/site` | Public configuration (including `site.announcement`), `s-maxage=60` |
| GET | `/api/site/stats` | Posts / topics / replies / members today, `s-maxage=60` |
| GET | `/api/nav` | Visible top navigation items (`link` / `categories`), `no-store` |
| GET | `/api/me` | Current user summary, 401 when signed out, `no-store` |
| GET | `/api/me/optional` | Current user summary; 200 `{user:null,permissions:null}` when signed out, used for first-paint detection |
| GET | `/api/categories`, `/api/categories/:slug` | Categories |
| GET | `/api/topics` | `category,tag,sort=latest\|new\|hot,digest=1,page,perPage`; `lastPostUser`,`isDigest` |
| GET | `/api/topics/:id` | Topic + first post + tags + viewerPermissions |
| GET | `/api/topics/:id/posts` | `page`/`perPage`/`onlyOp=1`, 20 floors per page; the first post is not in items, `total` includes it; for `onlyOp` the total counts only the first post + the OP's replies; cursor mode also excludes the first post |
| GET | `/api/tags`, `/api/tags/:slug` | Tags, tag detail (three statistics) |
| GET | `/api/search` | `q,page,perPage,sort=relevance\|latest`; post-level results |
| GET | `/api/users/:username`, `/topics`, `/replies` | User profile (including topicCount/replyCount/likeCount/bookmarkCount) |
| GET | `/api/health` | Version, configuration version, DB/R2 connectivity; R2 probe cached for 30s; `turnstileConfigured` means both Site Key and Secret are configured |

### Writes

| Method | Path | Permissions | Description |
|---|---|---|---|
| POST | `/api/topics` | Verified + Turnstile | `{categoryId,title,contentMd,tagIds}` |
| PATCH | `/api/topics/:id` | Author/moderator/admin | Carries `version`, 409 on conflict |
| DELETE | `/api/topics/:id` | Author(as configured)/moderator/admin | Soft delete |
| POST | `/api/topics/:id/view` | Public | Deduplicated per `topic + IP hash` for 5 minutes, only +1 per window |
| POST | `/api/topics/:id/posts` | Verified + Turnstile | `{contentMd,parentPostId?}`; `parentPostId` means a floor reply only (at most 2 levels); quotes pass no `parentPostId` and are written as an ordinary new floor |
| PATCH/DELETE | `/api/posts/:id` | Author/moderator/admin | Same as above |
| POST | `/api/posts/:id/like`, `/api/topics/:id/bookmark` | Idempotent toggle; a like is a single INSERT OR IGNORE plus a count recalculation |
| GET | `/api/topics/:id/revisions?postId=` | Per history visibility configuration (P3 already implements public/author/staff) |
| POST | `/api/reports` | Signed in | Deduplicated per target for 24h |
| POST | `/api/mod/topics/:id/digest` | Moderator/admin | `{isDigest}`, digest |
| POST | `/api/uploads/sign`, `/api/uploads/complete`, `/api/uploads/direct` | Verified + `feature.uploads` | Presigned direct upload / HEAD re-check / Worker fallback direct upload; images are JPG/PNG/WebP/GIF/AVIF only, attachments are ZIP/RAR/7Z only |
| GET | `/files/*` | Public | R2 object fallback reads locally or without a CDN |

### Personal center and administration

`GET /api/me/summary|topics|replies|bookmarks|notifications`, `POST /api/me/notifications/read`, `GET|PATCH /api/me/preferences`, `POST /api/me/delete|delete/cancel|export`, `POST /api/unsubscribe`, `GET /api/unsubscribe/preview`. Avatar and profile editing endpoints are not implemented yet.

Moderator: `GET /api/mod/reports`, `POST /api/mod/reports/:id/resolve`, `POST /api/mod/topics/:id/pin|lock|move`.
Administrator operations: `GET /api/mod/audit`, `POST /api/mod/posts/:id/restore`; the admin "Audit Log" page can restore deleted topics/replies directly.
Administrator: `GET /api/admin/overview`, `settings`, `emails`, `search/reindex`, `maintenance/daily`, `users`.

User management (administrator): `GET /api/admin/users?q=&status=&role=&page=` (20 per page), `PATCH /api/admin/users/:id` (role), `POST /api/admin/users/:id/suspend|unsuspend`; operating on yourself is forbidden, demoting/banning the last active administrator is forbidden, and a suspension deletes all of that user's sessions and writes a `user.suspend` audit entry.

Category maintenance (administrator): `GET|POST /api/admin/categories`, `PATCH|DELETE /api/admin/categories/:id`, `PATCH /api/admin/categories/reorder`. Deletion first checks whether the category still contains topics, and returns `conflict` if it does.

Moderator assignment (administrator): `POST /api/admin/categories/:id/moderators` (`{username}`, email also accepted), `DELETE /api/admin/categories/:id/moderators/:userId`. Adding a regular user automatically raises `user.role` to `moderator`; removing the last category mapping automatically falls back to `user`; administrators already hold site-wide permissions and are rejected.

Tag maintenance (administrator): `GET|POST /api/admin/tags`, `PATCH|DELETE /api/admin/tags/:id`. Supports name, slug, description, color and the `active/hidden/merged` status; a tag still referenced by topics cannot be deleted and returns `conflict`.

Navigation maintenance (administrator): `GET|POST /api/admin/nav`, `PATCH|DELETE /api/admin/nav/:id`, `PATCH /api/admin/nav/reorder`; the public read is `GET /api/nav` (`no-store`, visible items only).

Integrations (administrator): `GET|PATCH /api/admin/integrations`, `POST /api/admin/integrations/test`. PATCH accepts `version`, the non-secret `integration.cloudflare` and `secrets.{resendApiKey,resendWebhookSecret,turnstileSecret,r2AccessKeyId,r2SecretAccessKey}`; writing non-secrets requires the current `version` and the response returns the new `version`; secrets are never echoed back after writing, only `configured/source/updatedAt` is returned.

v2 notifications additionally return `postFloor`, which the front end uses to build `?page=N#post-F`; the home page, categories, tags and user lists all return `lastPostUser` (may be null).

The report list filters on `reports.category_id` on the SQL side and paginates directly with `LIMIT/OFFSET`, returning `total/totalPages`; the admin page is already wired to page numbers. Creating a report writes a target snapshot, so after the target is deleted the list still shows the snapshot; the resolve endpoint allows closing it and audits `contentRemoved` instead of returning 410. Moving a topic updates the `category_id` of pending reports in step. Tag usage counts, public and in admin, are live aggregates of `topic_tags JOIN topics(published)`; `tags.usage_count` is a compatibility redundancy only.

## Configuration items

`settings` stores override values while `DEFAULTS` in code provides the full set; reads deep-merge, writes are Zod-validated, reads are parsed safely (a bad value falls back to the default with a warning). Regular domains are cached for 45s, security domains for 5s. `PATCH /api/admin/settings` must carry `{version, patch}`; the version advances with a single conditional `UPDATE version = version + 1 WHERE version = ?` on the `settings('__config_version')` row, and a mismatch returns 409 `version_conflict`, avoiding TOCTOU across isolates.

| Domain | Keys and defaults |
|---|---|
| site | name=Pineboard; tagline=轻量、专注讨论的社区 (a lightweight, discussion-focused community); url; description; keywords; logoKey; faviconKey; ogImageKey; timezone=Asia/Shanghai; language=zh-CN; icp; announcement={id,enabled,text,href} |
| seo | titleTemplate=`{title} · {siteName}`; homeTitle; description; noindex=false; topicsPerPage=20 (5–50); postsPerPage=20 (5–50); sitemapEnabled=true |
| account | registrationOpen=true; allowUnverifiedLogin=true; requireVerificationForWrite=true; passwordMinLength=8; usernameMin=3; usernameMax=20; sessionDays=30; deletionGraceDays=7 |
| edit | windowUserMinutes=60; windowModeratorMinutes=0; allowStaffEditOthers=true; lockAfterReply=false; allowSelfDelete=true; historyVisibility=author; keepRevisions=20; requireReason=false |
| mail | enabled=true; fromName; fromAddress=no-reply@mail.example.com; replyTo; notifyTopicReply=true; notifyPostReply=true; notifyMention=true; notifyModeration=true; includeUnsubscribe=true; dailyBudget=80; userDailyCap=10; digestWindowMinutes=10; verificationTtlMinutes=60; resetTtlMinutes=30; unsubscribeTokenDays=180 |
| feature | turnstile=true; pwa=true; markdown=true; search=true; uploads=true; reports=true; guestRead=true |
| maintenance | enabled=false; message; allowAdmin=true |
| upload | imageMaxMb=5; fileMaxMb=10; userDailyCount=20; orphanTtlHours=24 (file types are validated by the route whitelist: images JPG/PNG/WebP/GIF/AVIF, attachments ZIP/RAR/7Z) |
| security | postMinIntervalSeconds=30; newUserDailyPosts=10; mentionMaxPerPost=5; reportDailyLimit=10; signupPerHour=5 (fixed IP window before Turnstile) |
| integration | cloudflare.accountId=""; cloudflare.r2Bucket=""; cloudflare.cdnUrl=""; cloudflare.turnstileSiteKey="" (empty values fall back to Worker variables) |
| theme | layout=classic; tokens={}; darkMode=system |

### Integration secrets (encrypted storage)

- Non-secret identifiers live in `settings.integration.*` and follow the regular configuration version and 45s cache.
- Secrets live in `settings` as `secrets.<name>` (`group_name='secrets'`) with an AES-GCM ciphertext value (the key is derived from `BETTER_AUTH_SECRET`); the admin UI only sees status.
- At runtime database secrets take precedence over Worker secrets; rotating Resend/Turnstile/R2 credentials therefore needs no redeploy.
- The Turnstile Site Key resolves as `integration.cloudflare.turnstileSiteKey` → `TURNSTILE_SITE_KEY`; the Secret resolves as `secrets.turnstileSecret` → `TURNSTILE_SECRET`.
- `/api/site` still exposes only the public Site Key and returns no secrets or the `integration` group.

## Content limits

Body ≤32KB; ≤5 tags; ≤10 attachments; single request body ≤100KB; usernames match `[a-z0-9_-]{3,20}` and pass a reserved-word blacklist. Floors take their number with the single statement `COALESCE(MAX(floor),0)+1`, with `UNIQUE(topicId,floor)`.
