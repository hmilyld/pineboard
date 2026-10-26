import { betterAuth } from "better-auth";
import { genericOAuth } from "better-auth/plugins";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/d1";
import { schema } from "./schema";
import { instrumentD1 } from "./trace";
import type { Env } from "./env";

export type AuthOptions = {
  /** Force the Drizzle adapter's interactive transaction support on/off. */
  transaction?: boolean;
  /** Better Auth 1.7's built-in gate against OAuth-merging an unverified local row. */
  requireLocalEmailVerified?: boolean;
  /** Implements docs/03's unverified-link patch: delete credential + revoke sessions. */
  guardUnverifiedLink?: boolean;
};

const encoder = new TextEncoder();
const DERIVED_RE = /^v1\$[A-Za-z0-9+/=]{43,}$/;

async function hmacB64(pepper: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

function timingSafeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    diff |= left[i] ^ right[i];
  }
  return diff === 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeEmailFromToken(token: string | undefined): string {
  if (!token) return "oauth@example.test";
  const value = token.startsWith("spike-access:") ? token.slice("spike-access:".length) : token;
  try {
    return atob(value);
  } catch {
    return value;
  }
}

export function createAuth(
  env: Env,
  ctx: { waitUntil(promise: Promise<unknown>): void },
  options: AuthOptions = {},
) {
  const phoneHome = async (kind: string, payload: Record<string, unknown>) => {
    // Spike-only marker: proves the send is deferred via waitUntil rather than
    // awaited on the request path (constraint 7).
    ctx.waitUntil(
      sleep(250)
        .then(() =>
          env.DB.prepare(
            "INSERT INTO spike_outbox (id, kind, payload, created_at) VALUES (?, ?, ?, ?)",
          )
            .bind(crypto.randomUUID(), kind, JSON.stringify(payload), Math.floor(Date.now() / 1000))
            .run(),
        )
        .catch(() => undefined),
    );
  };

  const db = drizzle(instrumentD1(env.DB), { schema });

  return betterAuth({
    baseURL: env.SITE_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, {
      provider: "sqlite",
      transaction: options.transaction ?? false,
    }),
    trustedOrigins: [env.SITE_URL, "http://localhost:5173", "http://127.0.0.1:8787"],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      minPasswordLength: 8,
      maxPasswordLength: 256,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 1800,
      password: {
        hash: async (password: string) => {
          if (!DERIVED_RE.test(password)) {
            throw new Error("password must be a client-side v1 derived value");
          }
          return hmacB64(env.PASSWORD_PEPPER, password);
        },
        verify: async ({ hash, password }: { hash: string; password: string }) => {
          if (!DERIVED_RE.test(password)) return false;
          return timingSafeEqual(hash, await hmacB64(env.PASSWORD_PEPPER, password));
        },
      },
      sendResetPassword: async ({ user, url, token }) => {
        await phoneHome("reset", { email: user.email, url, token });
      },
      onPasswordReset: async ({ user }) => {
        await phoneHome("reset-complete", { email: user.email });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: false,
      expiresIn: 3600,
      sendVerificationEmail: async ({ user, url, token }) => {
        await phoneHome("verify", { email: user.email, url, token });
      },
    },
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["google", "github", "test-oauth"],
        allowDifferentEmails: false,
        ...(options.requireLocalEmailVerified === undefined
          ? {}
          : { requireLocalEmailVerified: options.requireLocalEmailVerified }),
      },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 1000,
      storage: "database",
      modelName: "rateLimit",
    },
    user: {
      additionalFields: {
        username: { type: "string", required: false, input: true },
        role: { type: "string", required: false, input: false, defaultValue: "user" },
        status: { type: "string", required: false, input: false, defaultValue: "active" },
        bio: { type: "string", required: false, input: true },
        avatarKey: { type: "string", required: false, input: false },
        timezone: { type: "string", required: false, input: true },
        lastSeenAt: { type: "number", required: false, input: false },
        deletedAt: { type: "number", required: false, input: false },
      },
    },
    databaseHooks: {
      account: {
        create: {
          before: async (createdAccount) => {
            if (!options.guardUnverifiedLink) return;
            if (createdAccount.providerId === "credential") return;
            const local = await env.DB.prepare(
              'SELECT email_verified FROM "user" WHERE id = ?',
            )
              .bind(createdAccount.userId)
              .first<{ email_verified: number }>();
            if (!local || local.email_verified) return;
            await env.DB.batch([
              env.DB.prepare("DELETE FROM account WHERE user_id = ? AND provider_id = 'credential'").bind(
                createdAccount.userId,
              ),
              env.DB.prepare("DELETE FROM session WHERE user_id = ?").bind(createdAccount.userId),
            ]);
            await env.DB.prepare(
              "INSERT INTO spike_outbox (id, kind, payload, created_at) VALUES (?, ?, ?, ?)",
            )
              .bind(
                crypto.randomUUID(),
                "account.link.unverified_guard",
                JSON.stringify({ userId: createdAccount.userId }),
                Math.floor(Date.now() / 1000),
              )
              .run();
          },
          after: async (createdAccount) => {
            if (createdAccount.providerId !== "credential") {
              await env.DB.prepare(
                "INSERT INTO spike_outbox (id, kind, payload, created_at) VALUES (?, ?, ?, ?)",
              )
                .bind(
                  crypto.randomUUID(),
                  "account.link",
                  JSON.stringify({ providerId: createdAccount.providerId, userId: createdAccount.userId }),
                  Math.floor(Date.now() / 1000),
                )
                .run();
            }
            await phoneHome("account-created", {
              providerId: createdAccount.providerId,
              userId: createdAccount.userId,
            });
          },
        },
      },
    },
    plugins: [
      genericOAuth({
        config: [
          {
            providerId: "test-oauth",
            clientId: "spike-client",
            clientSecret: env.TEST_OAUTH_CLIENT_SECRET,
            authorizationUrl: `${env.SITE_URL}/spike/oauth/authorize`,
            tokenUrl: `${env.SITE_URL}/spike/oauth/token`,
            userInfoUrl: `${env.SITE_URL}/spike/oauth/userinfo`,
            scopes: ["email", "profile"],
            pkce: true,
            getUserInfo: async (tokens) => {
              const accessToken =
                (tokens as { accessToken?: string; access_token?: string }).accessToken ??
                (tokens as { access_token?: string }).access_token;
              const email = decodeEmailFromToken(accessToken);
              return {
                id: `oauth-${email}`,
                email,
                emailVerified: true,
                name: "OAuth User",
              };
            },
          },
        ],
      }),
    ],
    advanced: {
      defaultCookieAttributes: {
        sameSite: "lax",
        secure: true,
        httpOnly: true,
        path: "/",
      },
    },
  });
}
