# 04 Content Pipeline: Turnstile, Search, Upload

English | [简体中文](zh-CN/04-content-turnstile-search-upload.md)

## Turnstile

- Managed mode; the frontend Vue component fixes `action`: `signup` / `topic_create` / `post_create` / `post_edit`.
- Default `appearance: "interaction-only"`: when there is no challenge the widget takes no height and does not bother the user; it only appears in place when Cloudflare needs confirmation.
- When `error-callback` fires, or there is still no token on submit, switch to `appearance: "always"` and re-render so the user can complete the verification manually; on success the token comes back through `callback`.
- On submit, use an existing token directly if present; after any failure you must `reset()`, otherwise the retry may hit `timeout-or-duplicate`.
- The server order is fixed: **payload validation → permissions/email verification → write rate limiting → siteverify → database write**. A parameter error must not consume the token first.
- siteverify carries `secret`, `response`, `remoteip = CF-Connecting-IP`, has a 5s timeout, and validates the returned `action` and `hostname`. The hostname is the domain of the page mounting the widget (`forum.example.com`), not the API domain — this project is same-origin, so the two match.
- Error mapping: `invalid-input-response` / `timeout-or-duplicate` → 400 `captcha_failed`; `internal-error` / network timeout → 503 `captcha_unavailable`, keeping the editor content.
- Global switch `feature.turnstile`; when off, verification is skipped. **Without a Site Key, both frontend and backend consistently treat it as "not enabled"**: `/api/site` sends `feature.turnstile=false` and the backend skips siteverify; `/api/health.turnstileConfigured` is used for monitoring. When a Site Key exists but the Secret is missing, return `captcha_unavailable`. The signup entry uses the same setup.
- E2E uses the official test keys (always-pass / always-fail); never run automation against production keys.

## Sensitive words and the review queue

Editing published content is a write path: `PATCH /api/topics/:id` and `PATCH /api/posts/:id` carry `action: "post_edit"`, the same create-path rate limit, and the same siteverify order. Without this, a clean post could be edited into spam after the fact.

Keyword screening **diverts content to review, it does not reject it**:

- Match engine: `packages/shared/src/sensitive.ts`, a small trie. The operator list is expected to hold a few hundred terms, so building it costs well under 1 ms — the Aho-Corasick alternative needs ~200 ms and would break the Workers free-plan 10 ms CPU budget.
- Evasion handling is limited to the cheap, high-value case: whitespace and punctuation inside a match are skipped (`代 开 发 票` matches), capped at `n + 2` filler characters per match so short words are not found inside long sentences. Full-width/full Unicode normalisation is deliberately out of scope.
- On a hit, topics and posts are written with `status='pending'` instead of `published`. Every public read filters `status = 'published'`, so pending content is invisible to visitors and absent from search.
- A pending reply does not bump `reply_count` / `last_post_at`, and does not send mention or reply notifications. Approving it applies those counters once.
- Editing the opening post into flagged text moves the whole topic to `pending`, so the thread disappears until reviewed.
- Queue API: `GET /api/mod/pending`, `POST /api/mod/topics/:id/review`, `POST /api/mod/posts/:id/review` (`{ action: "approve" | "reject", reason? }`). Moderators only see their own categories; admins see everything.
- To limit false positives, ship no short generic words: the default list in `DEFAULT_SENSITIVE_WORDS` only holds high-confidence fraud/illegal terms, and the list itself defaults to empty until an operator seeds it in `/admin/reviews`.
- Config: `security.sensitiveWords` (max 2000 entries, 1–32 characters) and `security.sensitiveWordsEnabled`. Both are edited in `/admin/reviews`; turning the switch off publishes directly again.
- Audit: `topic.create` / `post.create` / `post.edit` log `{ keywords: [...] }` on a hit, and the queue reads it back for the moderator; `review.approve` / `review.reject` record who decided.


## Chinese search

P5 has implemented it: the FTS5 migration, dual writes in the topic/reply/edit/delete batches, `/api/search`, single-character LIKE fallback, and admin reindex. After deployment, run a reindex once to backfill historical posts.

FTS5's `unicode61` does not segment Chinese, so a whole sentence becomes one token. The approach: generate bigram strings on write.

```
"游戏攻略分享" → "游戏 戏攻 攻略 略分 分享"
"Elden Ring 攻略" → "elden ring 攻略"
```

- Normalization: NFKC, lowercase, strip zero-width characters, strip Markdown markers, punctuation to spaces.
- Both the body and the title go into `post_search`; `post_uid` / `topic_id` use `UNINDEXED`.
- Queries are bigrammed the same way and assembled into phrase queries on the server; **double quotes must be escaped**, and raw concatenation into `MATCH` is forbidden.
- Single-character queries fall back to `LIKE` (with `ESCAPE`) and limit the number of results.
- Ordering: relevance via `bm25()`, or by time.
- The query side joins `posts/topics` and returns only `published`, so index lag cannot leak hidden/deleted content.
- Admins can rebuild everything; sample 50 rows weekly to compare for drift.
- When `feature.search=false` the frontend hides the entry and the API returns 404.

## Markdown

- Rendering happens only in the browser: `markdown-it` + `DOMPurify`, raw HTML is forbidden; external links get `rel="noopener noreferrer"`; images are lazy-loaded.
- When `feature.markdown=false`, render as plain text with `white-space: pre-wrap`.
- The server only stores `contentMd` and the plain text `contentText` (a truncated summary) and does no HTML rendering.
- Before parsing @mentions, strip code blocks, inline code, and links; regex `(?<![\w@])@([a-z0-9_-]{3,20})`; max 5 people per post; only notify existing users who can see that topic; @-mentioning yourself sends no notification.

## R2 uploads

**Type allowlist**:

- Images: `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `image/avif`; extensions are derived uniformly from the MIME type.
- Attachments: only the ZIP/RAR/7Z archives; PDF is no longer an attachment type.
- **SVG/HTML are forbidden**; all object keys are generated by the server and the original filename is never trusted.

**Presigned direct upload**:

1. `POST /api/uploads/sign`: logged in + email verified + `feature.uploads` → validate by type/size/daily quota → generate `uploads/<userId>/<kind>/<yyyyMM>/<random>.<ext>` → do the SigV4 presigned PUT with WebCrypto inside the Worker, expiring in 10 minutes. `X-Amz-SignedHeaders` includes `content-length;content-type;host`, binding the size and MIME type as well.
2. The browser `PUT`s directly to `https://<account>.r2.cloudflarestorage.com/<bucket>/<key>`. The R2 bucket needs CORS configured: allow `PUT` and the `Content-Type` request header from the site origin.
3. `POST /api/uploads/complete`: `HEAD` the key, verifying the ownership prefix, the real size, and that the MIME type matches the declaration; on success return the CDN URL.
4. The browser sends `Content-Length` automatically; the signature is already bound to the declared size. `complete` re-checks with HEAD, and the daily quota plus orphan cleanup provide the backstop.

**Worker direct-upload fallback**:

- When the R2 S3 credentials are missing, the bucket has no CORS configured, or the local Miniflare environment cannot do cross-origin PUT, the frontend automatically falls back to `POST /api/uploads/direct`.
- The direct path writes through `BUCKET.put` and validates the magic bytes (JPEG/PNG/WebP/GIF/AVIF, ZIP/RAR/7Z), then re-checks with `HEAD`.
- A daily maintenance run collects the key sets from `posts.content_md`, `post_revisions.content_md`, `user.avatar_key`, and `settings.value_json`, then walks R2; it only deletes unreferenced objects older than `upload.orphanTtlHours`, at most 200 per round.
- Worker direct upload reads as a stream and aborts immediately past 25MB or `fileMaxMb`, so `arrayBuffer()` cannot exhaust memory.
- Local development returns `/files/<key>`, with the Worker reading the R2 binding; production prefers the configured CDN URL. `/files/*` must be in `run_worker_first`.

**Switches and sizes**:

- The admin console's "Site settings → Registration & writes" provides the `feature.uploads` switch; when off, the editor hides the upload button and the API returns 403.
- Defaults are 5MB for images, 10MB for attachments, and 20 uploads per user per day; they come from the `upload` config group.
- The editor's image/attachment buttons only appear when logged in and uploads are allowed; images insert `![name](url)` and attachments insert `[name](url)`.

**Security**:

- Non-images get `Content-Disposition: attachment`; responses carry `X-Content-Type-Options: nosniff`.
- Keys are random and isolated per user; directory listing is disabled on the bucket.
- The CDN uses a separate subdomain, and the session cookie is host-only, so it is never sent to `cdn.`.
- CSP allows connections to `https://*.r2.cloudflarestorage.com` and HTTPS images; it is no longer limited to a fixed CDN domain.

## Reports (v1)

- Logged-in users can report topics/replies; only one `pending` report per target at a time (partial unique index).
- Moderators see the list in the admin console and can mark it `resolved` or `dismissed`; the outcome is written to the audit log and the reporter receives an in-site notification.
- Reports never auto-hide content, to avoid abuse; moderators hide/delete manually.
