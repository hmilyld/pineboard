# 03 认证、权限、编辑留痕与邮件

[English](../03-auth-permissions-email.md) | 简体中文

## Better Auth 初始化

D1 绑定是请求级的，**不要模块作用域建实例**。每个请求 `createAuth(env, ctx)`，或按 isolate 懒初始化并把 `ExecutionContext` 通过闭包传入 hook。

```ts
const auth = createAuth(env, c.executionCtx);
app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));
```

`baseURL = SITE_URL`，`trustedOrigins = [SITE_URL]`，`advanced.defaultCookieAttributes = { sameSite:'lax', secure:true, httpOnly:true, path:'/' }`。**不设 `crossSubDomainCookies`。**

## 密码：浏览器派生 + 服务端 HMAC

免费版 10ms CPU 跑不动 scrypt。前端：

```ts
const salt = new TextEncoder().encode(`forum:v1:${email.trim().toLowerCase()}`);
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
const bits = await crypto.subtle.deriveBits({ name:'PBKDF2', hash:'SHA-256', salt, iterations:310_000 }, key, 256);
const derived = 'v1$' + btoa(String.fromCharCode(...new Uint8Array(bits)));
```

服务端 `emailAndPassword.password`：

```ts
hash: (d) => hmacB64(env.PASSWORD_PEPPER, d),
verify: async ({ hash, password }) => timingSafeEqual(hash, await hmacB64(env.PASSWORD_PEPPER, password)),
```

P1 实现（2026-10-22）：`TURNSTILE_SITE_KEY` 为公开标识，测试 key 为 `1x00000000000000000000AA`/`1x0000000000000000000000000000000AA`，只放在本地 `.dev.vars`；生产不再提交测试 key，由后台 `/admin/integrations` 或 Worker 变量配置。后台值优先于环境变量；本地 `ENVIRONMENT=development` 时 cookie 不加 `Secure`（localhost 无 HTTPS），staging/production 强制 `Secure`。Turnstile 在校验载荷、注册开关、按 IP 频率限制之后才 siteverify。

要点：
- 账户「账户与数据」页提供修改密码：输入当前密码 + 两次新密码，成功后保留当前会话、撤销其他会话。
- 注册/登录/改密/重置四个表单都先派生；邮箱是盐，因此 **v1 默认禁止改邮箱**（配置项已移除）。将来开启时，改邮箱流程必须同时强制重设密码。
- 服务端校验格式 `^v1\$[A-Za-z0-9+/=]{43,}$`，防止绕过前端提交原始弱密码。
- `PASSWORD_PEPPER` 轮换可增量：登录时用旧 pepper 验证成功后，用同一派生值重算新哈希并覆盖，无需全员重置。
- 在线爆破不受 KDF 保护：登录必须 `rateLimit.storage='database'`，连续失败后加 Turnstile。
- 密码强度只能在浏览器端校验。

## 注册、验证、重置

1. 注册：Turnstile → `signUpEmail`（密码传派生值）→ `requireEmailVerification=false` → 允许登录但写操作被中间件拦截。
2. 验证邮件：hook 内 `waitUntil`，链接指向**前端页面** `/verify-email?token=`，用户点“确认验证”按钮后才调 verify 接口，避免邮件扫描器预取消费令牌。
3. 重置：`forget-password` 无论邮箱是否存在都返回 200；存在才 `waitUntil` 发信，消除时序侧信道。令牌 30 分钟、单次。成功后吊销该用户全部 session（`revokeSessionsOnPasswordReset: true` + 手动删 session 行），并 bump 其退订令牌 version。
4. Resend 关闭 click/open tracking，否则链接被改写和预取。

## OAuth 与同邮箱合并（v1 不启用，预留到 v1.1）

**已定：v1 只做邮箱 + 密码登录。** Google / GitHub 只保留配置项、数据库 account 表字段与前端按钮位置，`socialProviders` 不填 client id/secret，OAuth 路由不对外启用；v1 不实现同邮箱合并，也没有“未验证本地账户被 OAuth 接管”的攻击面。启用前仍按下面设计执行。

`accountLinking: { enabled:true, trustedProviders:['google','github'], allowDifferentEmails:false }`。

```
provider 邮箱已验证
├─ 无同邮箱账户 → 建 user，自动生成唯一 username
├─ 本地账户已验证 → 关联 account，写 audit_logs('account.link')
├─ 本地账户未验证 → 关联 + 删除 credential account + 吊销全部 session
│                    + audit_logs('account.link.unverified_guard')
└─ 邮箱不同 → 冲突，提示先用原方式登录后绑定
```

第三条是必须的安全补丁：否则攻击者可先注册受害者邮箱（不验证也能登录），等受害者 OAuth 登录时自动并入，攻击者密码仍有效。

> **Spike 实测（2026-10-22）**：Better Auth 1.7.12 新增 `accountLinking.requireLocalEmailVerified`，默认 `true`。默认会在未验证本地账户上直接以 `account_not_linked` 拒绝合并（不删 credential、不吊销 session）；显式设 `false` 才会走上表第三条。Spike 已验证用 `databaseHooks.account.create.before` 可以在合并前删除 credential 并吊销 session。因为 v1 暂不启用 OAuth，这里的策略顺延到 v1.1 再定；届时优先评估保留库默认拒绝并补“先验证/重置”的 UX。

## 角色与权限

- `user`：默认。
- `moderator`：`role='moderator'` 且 `category_moderators` 有行；权限仅限管辖版块。后台分配版主时自动提升普通用户；移除最后一个版块映射后自动回退为 `user`。管理员用户管理页可改角色、封禁/解封；不能操作自己，不能降级或封禁最后一个活跃管理员。注销冷静期不会因任意请求自动取消，需显式调用 `POST /api/me/delete/cancel`。
- `admin`：全站；不能删除/降级最后一个 admin。

| 动作 | user | moderator | admin |
|---|---|---|---|
| 浏览/搜索 | ✓ | ✓ | ✓ |
| 发帖/回帖 | 已验证 + 开放注册 | ✓ | ✓ |
| 编辑自己 | 按 user 窗口 | 按 moderator 窗口 | 按 admin 窗口 |
| 编辑他人 | ✗ | 受 `allowStaffEditOthers` | ✓ |
| 删除自己 | 受 `allowSelfDelete` | ✓ | ✓ |
| 删他人/置顶/锁/移动 | ✗ | 管辖版块 | 全站 |
| 审核/举报处理 | ✗ | 管辖版块 | 全站 |
| 配置/用户/标签 | ✗ | ✗ | ✓ |

编辑判定顺序：admin 放行 → 版主在管辖版块且允许编辑他人则放行 → 作者按角色窗口 → 若 `lockAfterReply` 且首帖已有回复则拒绝 → 否则拒绝。`0` 分钟表示永久。非 `published` 内容作者不可编辑，仅管理员可恢复。

## 编辑留痕（单 batch + CAS）

P3 已实现快照 + CAS + 修订历史；FTS 双写在 P5 加表后补入同一 batch。

所有写语句带同一个 `version` 守卫；版本不匹配时整批无操作，用 `meta.changes` 判 409：

```ts
const [, , , upd] = await env.DB.batch([
  // 1 快照旧内容
  db.prepare(`INSERT INTO post_revisions (id,topic_id,post_id,version,title,content_md,action,editor_id,reason,created_at)
              SELECT ?, p.topic_id, p.id, p.version, p.title, p.content_md, 'edit', ?, ?, ?
              FROM posts p WHERE p.id=? AND p.version=?`).bind(...),
  // 2 失效旧检索
  db.prepare(`DELETE FROM post_search WHERE post_uid=? AND EXISTS
              (SELECT 1 FROM posts WHERE id=? AND version=?)`).bind(...),
  // 3 写新检索
  db.prepare(`INSERT INTO post_search (post_uid,topic_id,title,tokens)
              SELECT ?, topic_id, ?, ? FROM posts WHERE id=? AND version=?`).bind(...),
  // 4 CAS 更新主表
  db.prepare(`UPDATE posts SET title=COALESCE(?,title), content_md=?, content_text=?,
                version=version+1, edit_count=edit_count+1, edited_at=?, updated_at=?
              WHERE id=? AND version=?`).bind(...),
]);
if (upd.meta.changes === 0) return err('version_conflict', 409);
```

- 标题只存首帖，因此主题编辑与回复编辑共用一条路径。
- 保留最近 N 版（默认 20），同 batch 末尾或每日清理。
- 删除写 `action='delete'` 快照，恢复写 `restore`。
- 历史可见性：`public` / `author` / `staff`；管理员始终全量。

## 通知与邮件

站内通知永远写入；邮件另走通道：

| 类别 | 通道 |
|---|---|
| 验证、重置 | `waitUntil` 直发 |
| @提及、管理员操作 | `waitUntil` 直发（每帖最多 5 人） |
| 主题被回复、回复被回复 | `notifications` 表 + Cron 每 5 分钟摘要 |

P4 实现：站内通知/偏好/退订/摘要已落地；无 Resend key 时写 dev outbox；@提及时通过 `waitUntil` 直发，并生成退订令牌。

摘要任务：取 20 个待发用户 → 每用户最多取 50 条并原子 claim（`email_batch_key=claim:<ts>:<id>`，参数数 ≤ 100）→ 过滤全局开关/用户偏好/退订/已验证/账户状态 → 一次查询当日预算 → 合并为一封（最多 10 条）→ 先写 `email_logs(queued)`，再调 Resend（8s 超时、5xx 重试 1 次）→ 一条 UPDATE 批量更新状态。每个用户独立 try/catch；预算不足时 release 顺延而非 skipped；未处理 claim 由 5 分钟任务回收。

用户默认偏好：站内全开；邮件 `mention=on`、`topicReply=on`、`postReply=on`、`moderation=on 且不可关闭`。

退订：每类一个 32 字节随机令牌，库存 SHA-256，180 天过期，`version` 递增即旧链接失效。邮件底部 `GET /unsubscribe?token=` 只展示确认页，`POST /api/unsubscribe` 才生效；同时支持 `List-Unsubscribe` 与 `List-Unsubscribe-Post: One-Click`。

Resend 免费 100 封/日、1 个域名。接 `email.bounced` / `complained` webhook（Svix 校验），命中后停发并标记；发送带 `Idempotency-Key`；`dailyBudget` 默认 80 留余量。

## 注销实现（P5）

`POST /api/me/delete` 校验派生密码后把 `status` 置 `deleting`、写 `deletedAt`、删除全部 session；冷静期内登录不会自动恢复；需显式调用 `POST /api/me/delete/cancel`。每日 Cron 在 `deletionGraceDays` 后匿名化昵称/邮箱/头像/简介，保留主题与回复；清理任务也可由管理员手动触发。导出走 `POST /api/me/export`，返回 JSON 附件。

## 首个管理员

`ADMIN_EMAILS` 环境变量；用户首次验证/登录命中则升 `admin` 并写审计。日常授权用 `pnpm admin:grant <email>`。
