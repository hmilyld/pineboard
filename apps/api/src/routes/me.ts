import { fail, ok } from "@pineboard/shared";
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { requireAuth } from "../middleware/guards";

export const meRoutes = new Hono<AppEnv>();

meRoutes.get("/api/me/summary", requireAuth, async (c) => {
  const user = c.get("user")!;
  const row = await c.env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM topics WHERE author_id = ? AND status = 'published') AS topics,
       (SELECT COUNT(*) FROM posts WHERE author_id = ? AND is_first = 0 AND status = 'published') AS replies,
       (SELECT COUNT(*) FROM post_likes pl JOIN posts p ON p.id = pl.post_id WHERE p.author_id = ? AND p.status = 'published') AS likes,
       (SELECT COUNT(*) FROM bookmarks b JOIN topics t ON t.id = b.topic_id WHERE b.user_id = ? AND t.status = 'published') AS bookmarks,
       (SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at IS NULL) AS unread`,
  ).bind(user.id, user.id, user.id, user.id, user.id).first<{ topics: number; replies: number; likes: number; bookmarks: number; unread: number }>();
  c.header("cache-control", "no-store");
  return c.json(ok({
    topicCount: Number(row?.topics ?? 0),
    replyCount: Number(row?.replies ?? 0),
    likeCount: Number(row?.likes ?? 0),
    bookmarkCount: Number(row?.bookmarks ?? 0),
    unreadCount: Number(row?.unread ?? 0),
  }));
});

meRoutes.get("/api/me/optional", async (c) => {
  const user = c.get("user");
  const config = c.get("config");
  c.header("cache-control", "no-store");
  if (!user) return c.json(ok({ user: null, permissions: null, configVersion: String(c.get("configVersion")) }));
  return c.json(ok({
    user: {
      id: user.id, name: user.name, email: user.email, emailVerified: user.emailVerified,
      image: user.image, username: user.username, role: user.role, status: user.status,
      bio: user.bio, avatarKey: user.avatarKey, timezone: user.timezone,
      createdAt: Math.floor(user.createdAt.getTime() / 1000), updatedAt: Math.floor(user.updatedAt.getTime() / 1000),
    },
    permissions: {
      canWrite: user.emailVerified || !config.account.requireVerificationForWrite,
      isAdmin: user.role === "admin",
      isModerator: user.role === "moderator" || user.role === "admin",
    },
    configVersion: String(c.get("configVersion")),
  }));
});

meRoutes.get("/api/me", async (c) => {
  const user = c.get("user");
  const config = c.get("config");
  if (!user) {
    c.header("cache-control", "no-store");
    return c.json(fail("auth_required", "请先登录"), 401);
  }
  c.header("cache-control", "no-store");
  return c.json(
    ok({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        image: user.image,
        username: user.username,
        role: user.role,
        status: user.status,
        bio: user.bio,
        avatarKey: user.avatarKey,
        timezone: user.timezone,
        createdAt: Math.floor(user.createdAt.getTime() / 1000),
        updatedAt: Math.floor(user.updatedAt.getTime() / 1000),
      },
      permissions: {
        canWrite: user.emailVerified || !config.account.requireVerificationForWrite,
        isAdmin: user.role === "admin",
        isModerator: user.role === "moderator" || user.role === "admin",
      },
      configVersion: String(c.get("configVersion")),
    }),
  );
});
