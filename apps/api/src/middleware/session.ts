import type { MiddlewareHandler } from "hono";
import { ulid } from "@pineboard/shared";
import { createAuth, promoteAdminIfConfigured } from "../auth";
import type { AppEnv, SessionUser } from "../env";

function normalizeUser(raw: Record<string, unknown>): SessionUser {
  return {
    id: String(raw.id),
    name: String(raw.name ?? ""),
    email: String(raw.email ?? ""),
    emailVerified: Boolean(raw.emailVerified),
    image: (raw.image as string | null | undefined) ?? null,
    username: (raw.username as string | null | undefined) ?? null,
    role: (raw.role as SessionUser["role"] | undefined) ?? "user",
    status: (raw.status as SessionUser["status"] | undefined) ?? "active",
    bio: (raw.bio as string | null | undefined) ?? null,
    avatarKey: (raw.avatarKey as string | null | undefined) ?? null,
    timezone: (raw.timezone as string | null | undefined) ?? null,
    lastSeenAt: (raw.lastSeenAt as Date | null | undefined) ?? null,
    createdAt: (raw.createdAt as Date | undefined) ?? new Date(),
    updatedAt: (raw.updatedAt as Date | undefined) ?? new Date(),
  };
}

export const attachSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("user", null);
  c.set("session", null);
  if (c.req.path.startsWith("/api/auth/") || c.req.path === "/api/site") return next();

  const auth = createAuth(c.env, c.executionCtx, c.get("config"));
  try {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (session?.user) {
      let user = normalizeUser(session.user as unknown as Record<string, unknown>);
      // Deletion is cancelled only through the explicit endpoint (or a fresh sign-in flow),
      // never as a side effect of an arbitrary authenticated request.
      if (user.status === "suspended" || user.status === "deleted") {
        await next();
        return;
      }
      if (user.status === "active") {
        user = await promoteAdminIfConfigured(c.env, user);
      }
      c.set("user", user);
      c.set("session", {
        id: session.session.id,
        expiresAt: session.session.expiresAt,
      });
    }
  } catch {
    // Treat an invalid/expired cookie as anonymous.
  }
  await next();
};
