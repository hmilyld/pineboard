export type Role = "user" | "moderator" | "admin";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  username: string | null;
  role: Role;
  status: "active" | "suspended" | "deleting" | "deleted";
  bio: string | null;
  avatarKey: string | null;
  timezone: string | null;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

import type { AppConfig } from "@pineboard/shared";

export type Bindings = {
  DB: D1Database;
  BUCKET: R2Bucket;
  ASSETS: Fetcher;
  SITE_URL: string;
  CDN_URL: string;
  ENVIRONMENT: string;
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET: string;
  BETTER_AUTH_SECRET: string;
  PASSWORD_PEPPER: string;
  IP_HASH_SALT: string;
  ADMIN_EMAILS?: string;
  DEV_RESET_TOKEN?: string;
  RESEND_API_KEY?: string;
  RESEND_WEBHOOK_SECRET?: string;
  EMAIL_TRANSPORT?: "log" | "resend";
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET_NAME?: string;
  CF_VERSION_METADATA?: {
    id: string;
    tag: string;
    timestamp: string;
  };
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: {
    requestId: string;
    config: AppConfig;
    configVersion: number;
    user: SessionUser | null;
    session: { id: string; expiresAt: Date } | null;
  };
};
