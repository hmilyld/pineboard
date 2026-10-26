import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/d1";
import { schema } from "@pineboard/db";
import {
  DERIVED_PASSWORD_RE,
  hmacB64,
  timingSafeEqual,
  ulid,
  type AppConfig,
} from "@pineboard/shared";
import { dispatchEmail, resetPasswordEmail, verificationEmail } from "./email";
import type { Bindings, SessionUser } from "./env";

function adminEmails(env: Bindings): string[] {
  return (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export async function promoteAdminIfConfigured(env: Bindings, user: SessionUser): Promise<SessionUser> {
  if (!user.emailVerified || user.role === "admin") return user;
  if (!adminEmails(env).includes(user.email.toLowerCase())) return user;
  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare("UPDATE user SET role = 'admin', updated_at = ? WHERE id = ?").bind(now, user.id),
    env.DB.prepare(
      `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, meta_json, ip_hash, created_at)
       VALUES (?, NULL, 'user.bootstrap_admin', 'user', ?, NULL, NULL, ?)`,
    ).bind(ulid(), user.id, now),
  ]);
  return { ...user, role: "admin" };
}

export function createAuth(env: Bindings, ctx: { waitUntil(promise: Promise<unknown>): void }, config: AppConfig) {
  const db = drizzle(env.DB, { schema });
  // Deployment origin for auth links; config.site.url remains the public canonical.
  const siteUrl = env.SITE_URL.replace(/\/$/, "");
  const trustedOrigins = [
    ...new Set([
      env.SITE_URL,
      siteUrl,
      ...(env.ENVIRONMENT === "development"
        ? [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:5174",
            "http://127.0.0.1:5174",
            "http://localhost:4173",
            "http://127.0.0.1:4173",
          ]
        : []),
    ]),
  ];

  return betterAuth({
    baseURL: env.SITE_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: "sqlite", transaction: false }),
    trustedOrigins,
    telemetry: { enabled: false },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      autoSignIn: true,
      minPasswordLength: config.account.passwordMinLength,
      maxPasswordLength: 256,
      resetPasswordTokenExpiresIn: config.mail.resetTtlMinutes * 60,
      revokeSessionsOnPasswordReset: true,
      password: {
        hash: async (password: string) => {
          if (!DERIVED_PASSWORD_RE.test(password)) {
            throw new APIError("BAD_REQUEST", { message: "密码必须由客户端派生" });
          }
          return hmacB64(env.PASSWORD_PEPPER, password);
        },
        verify: async ({ hash, password }: { hash: string; password: string }) => {
          if (!DERIVED_PASSWORD_RE.test(password)) return false;
          return timingSafeEqual(hash, await hmacB64(env.PASSWORD_PEPPER, password));
        },
      },
      sendResetPassword: async ({ user, token }) => {
        const url = `${siteUrl}/reset-password?token=${encodeURIComponent(token)}&email=${encodeURIComponent(user.email)}`;
        const message = resetPasswordEmail(user.name, url, config.mail.resetTtlMinutes);
        ctx.waitUntil(
          dispatchEmail(env, config, {
            to: user.email,
            userId: user.id,
            category: "reset",
            template: "reset-password",
            token,
            url,
            ...message,
          }),
        );
      },
      onPasswordReset: async ({ user }) => {
        const now = Math.floor(Date.now() / 1000);
        try {
          await env.DB.prepare(
            `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, meta_json, ip_hash, created_at)
             VALUES (?, NULL, 'password.reset', 'user', ?, NULL, NULL, ?)`,
          )
            .bind(ulid(), user.id, now)
            .run();
        } catch {
          // Audit failure must not change the reset result.
        }
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: false,
      expiresIn: config.mail.verificationTtlMinutes * 60,
      sendVerificationEmail: async ({ user, token }) => {
        const url = `${siteUrl}/verify-email?token=${encodeURIComponent(token)}`;
        const message = verificationEmail(user.name, url, config.mail.verificationTtlMinutes);
        ctx.waitUntil(
          dispatchEmail(env, config, {
            to: user.email,
            userId: user.id,
            category: "verification",
            template: "verify-email",
            token,
            url,
            ...message,
          }),
        );
      },
      afterEmailVerification: async (user) => {
        await promoteAdminIfConfigured(env, {
          ...(user as unknown as SessionUser),
          role: ((user as unknown as { role?: SessionUser["role"] }).role ?? "user") as SessionUser["role"],
          emailVerified: true,
        });
      },
    },
    session: {
      expiresIn: config.account.sessionDays * 24 * 60 * 60,
      updateAge: Math.min(24 * 60 * 60, config.account.sessionDays * 12 * 60 * 60),
    },
    account: {
      accountLinking: { enabled: false, allowDifferentEmails: false, trustedProviders: [] },
    },
    user: {
      changeEmail: { enabled: false },
      additionalFields: {
        username: { type: "string", required: false, input: true },
        role: { type: "string", required: false, input: false, defaultValue: "user" },
        status: { type: "string", required: false, input: false, defaultValue: "active" },
        bio: { type: "string", required: false, input: false },
        avatarKey: { type: "string", required: false, input: false },
        timezone: { type: "string", required: false, input: false },
        lastSeenAt: { type: "number", required: false, input: false },
        deletedAt: { type: "number", required: false, input: false },
      },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "rateLimit",
      window: 60,
      max: 1000,
      customRules: {
        "/sign-up/email": { window: 60, max: 20 },
        "/sign-in/email": { window: 60, max: 30 },
        "/request-password-reset": { window: 60, max: 10 },
        "/reset-password": { window: 60, max: 10 },
      },
    },
    advanced: {
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      useSecureCookies: env.ENVIRONMENT !== "development",
      defaultCookieAttributes: {
        sameSite: "lax",
        secure: env.ENVIRONMENT !== "development",
        httpOnly: true,
        path: "/",
      },
      database: { generateId: () => ulid() },
    },
  });
}
