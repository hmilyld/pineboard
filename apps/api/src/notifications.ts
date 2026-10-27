import { fail, ok, ulid, type AppConfig } from "@pineboard/shared";
import { Hono } from "hono";
import type { Bindings, AppEnv } from "./env";
import { requireAuth } from "./middleware/guards";
import { dispatchEmail, mentionEmail } from "./email";

export const NOTIFICATION_CATEGORIES = ["topic_reply", "post_reply", "mention", "moderation"] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const DEFAULT_EMAIL_PREFS: Record<NotificationCategory, boolean> = {
  topic_reply: false,
  post_reply: false,
  mention: false,
  moderation: false,
};

export type NotificationInsert = {
  userId: string;
  type: "topic_reply" | "post_reply" | "mention" | "moderation" | "system";
  actorId: string;
  topicId: string;
  postId: string;
  title: string;
  snippet: string;
};

export async function getEmailPreferences(
  db: D1Database,
  userId: string,
): Promise<Record<NotificationCategory, boolean>> {
  const rows = await db
    .prepare("SELECT category, email_enabled FROM notification_preferences WHERE user_id = ?")
    .bind(userId)
    .all<{ category: NotificationCategory; email_enabled: number }>();
  const result = { ...DEFAULT_EMAIL_PREFS };
  for (const row of rows.results) {
    if (NOTIFICATION_CATEGORIES.includes(row.category)) result[row.category] = Number(row.email_enabled) === 1;
  }
  return result;
}

export async function setEmailPreferences(
  db: D1Database,
  userId: string,
  patch: Partial<Record<NotificationCategory, boolean>>,
): Promise<Record<NotificationCategory, boolean>> {
  const now = Math.floor(Date.now() / 1000);
  const current = await getEmailPreferences(db, userId);
  const next = { ...current, ...patch };
  const statements = NOTIFICATION_CATEGORIES.map((category) =>
    db
      .prepare(
        `INSERT INTO notification_preferences (user_id, category, email_enabled, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, category) DO UPDATE SET email_enabled = excluded.email_enabled, updated_at = excluded.updated_at`,
      )
      .bind(userId, category, next[category] ? 1 : 0, now),
  );
  await db.batch(statements);
  return next;
}

export function extractMentions(markdown: string, max: number): string[] {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ");
  const found = new Set<string>();
  for (const match of plain.matchAll(/(?<![\w@])@([a-z0-9_-]{3,20})/g)) {
    found.add(match[1]!.toLowerCase());
    if (found.size >= max) break;
  }
  return [...found];
}

export async function buildReplyNotifications(
  db: D1Database,
  input: {
    topicId: string;
    topicAuthorId: string;
    parentPostId?: string | null;
    actorId: string;
    postId: string;
    title: string;
    snippet: string;
    contentMd: string;
    mentionMax: number;
  },
): Promise<NotificationInsert[]> {
  const recipients = new Map<string, NotificationInsert>();
  const add = (userId: string | null | undefined, type: NotificationInsert["type"]) => {
    if (!userId || userId === input.actorId || recipients.has(userId)) return;
    recipients.set(userId, {
      userId,
      type,
      actorId: input.actorId,
      topicId: input.topicId,
      postId: input.postId,
      title: input.title,
      snippet: input.snippet,
    });
  };

  add(input.topicAuthorId, "topic_reply");
  if (input.parentPostId) {
    const parent = await db
      .prepare("SELECT author_id FROM posts WHERE id = ? AND topic_id = ?")
      .bind(input.parentPostId, input.topicId)
      .first<{ author_id: string }>();
    add(parent?.author_id, "post_reply");
  }

  const mentions = extractMentions(input.contentMd, input.mentionMax);
  if (mentions.length) {
    const placeholders = mentions.map(() => "?").join(",");
    const users = await db
      .prepare(`SELECT id, username FROM user WHERE username IN (${placeholders}) AND status = 'active'`)
      .bind(...mentions)
      .all<{ id: string; username: string }>();
    for (const mention of users.results) add(mention.id, "mention");
  }
  return [...recipients.values()];
}

export async function sendMentionEmails(
  env: Bindings,
  config: AppConfig,
  items: NotificationInsert[],
): Promise<void> {
  const mentions = items.filter((item) => item.type === "mention");
  if (!mentions.length) return;
  const actor = await env.DB.prepare("SELECT name FROM user WHERE id = ?")
    .bind(mentions[0]!.actorId).first<{ name: string }>();
  const actorName = actor?.name ?? "有人";
  for (const item of mentions) {
    // The notification id is not carried in NotificationInsert, so update by
    // user/topic/post tuple to keep the helper independent of insert order.
    const markByTarget = async (status: string, logId: string | null) => {
      await env.DB.prepare(
        `UPDATE notifications SET email_status = ?, email_batch_key = ?
          WHERE user_id = ? AND topic_id = ? AND post_id = ? AND type = 'mention'`,
      ).bind(status, logId, item.userId, item.topicId, item.postId).run().catch(() => undefined);
    };
    try {
      if (!config.mail.enabled || !config.mail.notifyMention) {
        await markByTarget("skipped", null);
        continue;
      }
      const user = await env.DB.prepare("SELECT email, name, email_verified, status FROM user WHERE id = ?")
        .bind(item.userId).first<{ email: string; name: string; email_verified: number; status: string }>();
      if (!user || Number(user.email_verified) !== 1 || user.status !== "active") {
        await markByTarget("skipped", null);
        continue;
      }
      const prefs = await getEmailPreferences(env.DB, item.userId);
      if (!prefs.mention) {
        await markByTarget("skipped", null);
        continue;
      }
      const message = mentionEmail(
        user.name,
        actorName,
        item.title,
        item.snippet,
        `${env.SITE_URL.replace(/\/$/, "")}/t/${item.topicId}`,
        `${env.SITE_URL.replace(/\/$/, "")}/me/preferences`,
      );
      const unsubscribe = await createUnsubscribeToken(env, config, item.userId, "mention");
      const result = await dispatchEmail(env, config, {
        to: user.email,
        userId: item.userId,
        category: "mention",
        template: "mention",
        subject: message.subject,
        html: message.html,
        text: message.text,
        url: `${env.SITE_URL.replace(/\/$/, "")}/t/${item.topicId}`,
        unsubscribeUrl: unsubscribe.url.replace("/unsubscribe?", "/api/unsubscribe?"),
      });
      await markByTarget(result.status === "sent" ? "sent" : result.status === "skipped" ? "skipped" : "failed", result.logId);
    } catch (error) {
      console.error("mention email failed", error);
      await markByTarget("failed", null);
    }
  }
}

export function notificationStatements(db: D1Database, items: NotificationInsert[]): D1PreparedStatement[] {
  const now = Math.floor(Date.now() / 1000);
  return items.map((item) =>
    db.prepare(
      `INSERT INTO notifications (id, user_id, type, actor_id, topic_id, post_id, title, snippet, email_status, email_batch_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    ).bind(
      ulid(), item.userId, item.type, item.actorId, item.topicId, item.postId, item.title, item.snippet,
      // Mentions are delivered immediately via waitUntil; the sentinel keeps
      // the digest from racing a still-in-flight direct send.
      item.type === "mention" ? "direct" : null,
      now,
    ),
  );
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export async function createUnsubscribeToken(
  env: Bindings,
  config: { mail: { unsubscribeTokenDays: number } },
  userId: string,
  category: NotificationCategory,
): Promise<{ token: string; url: string }> {
  const token = randomToken();
  const hash = await sha256Hex(token);
  const now = Math.floor(Date.now() / 1000);
  const versionRow = await env.DB.prepare(
    "SELECT COALESCE(MAX(version), 0) AS version FROM email_unsubscribe_tokens WHERE user_id = ? AND category = ?",
  ).bind(userId, category).first<{ version: number }>();
  const version = Number(versionRow?.version ?? 0) + 1;
  await env.DB.prepare(
    `INSERT INTO email_unsubscribe_tokens (id, user_id, category, token_hash, version, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(ulid(), userId, category, hash, version, now + config.mail.unsubscribeTokenDays * 86_400, now).run();
  return { token, url: `${env.SITE_URL}/unsubscribe?token=${encodeURIComponent(token)}` };
}

export async function resolveUnsubscribeToken(
  env: Bindings,
  token: string,
): Promise<{ id: string; userId: string; category: NotificationCategory; email: string } | null> {
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT t.id, t.user_id, t.category, u.email
       FROM email_unsubscribe_tokens t JOIN user u ON u.id = t.user_id
      WHERE t.token_hash = ? AND t.used_at IS NULL AND t.expires_at >= unixepoch()
        AND t.version = (SELECT MAX(version) FROM email_unsubscribe_tokens
                          WHERE user_id = t.user_id AND category = t.category)`,
  ).bind(hash).first<{ id: string; user_id: string; category: NotificationCategory; email: string }>();
  if (!row) return null;
  return { id: row.id, userId: row.user_id, category: row.category, email: row.email };
}

export const notificationRoutes = new Hono<AppEnv>();

notificationRoutes.get("/api/me/notifications", requireAuth, async (c) => {
  const user = c.get("user")!;
  const pageRaw = Number(c.req.query("page") ?? 1);
  const perPageRaw = Number(c.req.query("perPage") ?? 20);
  const page = Number.isFinite(pageRaw) ? Math.max(1, Math.floor(pageRaw)) : 1;
  const perPage = Number.isFinite(perPageRaw) ? Math.min(50, Math.max(5, Math.floor(perPageRaw))) : 20;
  const unreadOnly = c.req.query("unread") === "1";
  const where = unreadOnly ? "AND n.read_at IS NULL" : "";
  const totalRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN read_at IS NULL THEN 1 ELSE 0 END) AS unread FROM notifications n WHERE n.user_id = ? ${where}`,
  ).bind(user.id).first<{ total: number; unread: number }>();
  const rows = await c.env.DB.prepare(
    `SELECT n.*, u.name AS actor_name, u.username AS actor_username, p.floor AS post_floor
       FROM notifications n LEFT JOIN user u ON u.id = n.actor_id
       LEFT JOIN posts p ON p.id = n.post_id
      WHERE n.user_id = ? ${where}
      ORDER BY n.created_at DESC LIMIT ? OFFSET ?`,
  ).bind(user.id, perPage, (page - 1) * perPage).all<Record<string, unknown>>();
  return c.json(ok({
    items: rows.results.map((row) => ({
      id: String(row.id),
      type: String(row.type),
      title: String(row.title),
      snippet: String(row.snippet ?? ""),
      topicId: String(row.topic_id),
      postId: (row.post_id as string | null) ?? null,
      postFloor: row.post_floor == null ? null : Number(row.post_floor),
      readAt: row.read_at == null ? null : Number(row.read_at),
      createdAt: Number(row.created_at),
      actor: row.actor_id ? { id: String(row.actor_id), name: String(row.actor_name ?? ""), username: (row.actor_username as string | null) ?? null } : null,
    })),
    unread: Number(totalRow?.unread ?? 0),
    total: Number(totalRow?.total ?? 0),
    page,
    perPage,
    totalPages: Math.max(1, Math.ceil(Number(totalRow?.total ?? 0) / perPage)),
  }));
});

notificationRoutes.post("/api/me/notifications/read", requireAuth, async (c) => {
  const user = c.get("user")!;
  const body = (await c.req.json().catch(() => ({}))) as { ids?: string[]; all?: boolean };
  const now = Math.floor(Date.now() / 1000);
  if (body.all) {
    await c.env.DB.prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL").bind(now, user.id).run();
  } else if (Array.isArray(body.ids) && body.ids.length) {
    const ids = [...new Set(body.ids.filter((id): id is string => typeof id === "string" && id.length <= 64))].slice(0, 200);
    for (let index = 0; index < ids.length; index += 50) {
      const chunk = ids.slice(index, index + 50);
      const placeholders = chunk.map(() => "?").join(",");
      await c.env.DB.prepare(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND id IN (${placeholders})`)
        .bind(now, user.id, ...chunk).run();
    }
  }
  return c.json(ok({ read: true }));
});

notificationRoutes.get("/api/me/preferences", requireAuth, async (c) => {
  const user = c.get("user")!;
  return c.json(ok({ email: await getEmailPreferences(c.env.DB, user.id), categories: NOTIFICATION_CATEGORIES }));
});

notificationRoutes.patch("/api/me/preferences", requireAuth, async (c) => {
  const user = c.get("user")!;
  const body = (await c.req.json().catch(() => ({}))) as { email?: Record<string, boolean> };
  const patch: Partial<Record<NotificationCategory, boolean>> = {};
  for (const category of NOTIFICATION_CATEGORIES) {
    if (typeof body.email?.[category] === "boolean") patch[category] = body.email[category]!;
  }
  return c.json(ok({ email: await setEmailPreferences(c.env.DB, user.id, patch) }));
});

notificationRoutes.get("/api/unsubscribe/preview", async (c) => {
  const token = c.req.query("token") ?? "";
  const resolved = token ? await resolveUnsubscribeToken(c.env, token) : null;
  if (!resolved) return c.json(fail("not_found", "退订链接无效或已过期"), 404);
  const [name, domain] = resolved.email.split("@");
  return c.json(ok({ email: `${name!.slice(0, 1)}***@${domain}`, category: resolved.category, valid: true }));
});

notificationRoutes.post("/api/unsubscribe", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { token?: string };
  const token = body.token ?? c.req.query("token");
  if (!token) return c.json(fail("validation_error", "缺少退订令牌"), 400);
  const resolved = await resolveUnsubscribeToken(c.env, token);
  if (!resolved) return c.json(fail("not_found", "退订链接无效或已过期"), 404);
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE email_unsubscribe_tokens SET used_at = ? WHERE id = ?").bind(now, resolved.id),
    c.env.DB.prepare("UPDATE email_unsubscribe_tokens SET version = version + 1 WHERE user_id = ? AND category = ?").bind(resolved.userId, resolved.category),
    c.env.DB.prepare(
      `INSERT INTO notification_preferences (user_id, category, email_enabled, updated_at)
       VALUES (?, ?, 0, ?)
       ON CONFLICT(user_id, category) DO UPDATE SET email_enabled = 0, updated_at = excluded.updated_at`,
    ).bind(resolved.userId, resolved.category, now),
    c.env.DB.prepare(
      `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, meta_json, ip_hash, created_at)
       VALUES (?, NULL, 'email.unsubscribe', 'user', ?, ?, NULL, ?)`,
    ).bind(ulid(), resolved.userId, JSON.stringify({ category: resolved.category }), now),
  ]);
  return c.json(ok({ unsubscribed: true, category: resolved.category }));
});
