import { z } from "zod";

/** Kept here (not in upload.ts) so Node-based e2e can import this module directly. */
export const UPLOAD_IMAGE_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
] as const;

export const UPLOAD_ARCHIVE_MIME = [
  "application/zip",
  "application/x-zip-compressed",
  "application/vnd.rar",
  "application/x-rar-compressed",
  "application/x-7z-compressed",
] as const;

export const UPLOAD_IMAGE_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

export const UPLOAD_ARCHIVE_EXT: Record<string, string> = {
  "application/zip": "zip",
  "application/x-zip-compressed": "zip",
  "application/vnd.rar": "rar",
  "application/x-rar-compressed": "rar",
  "application/x-7z-compressed": "7z",
};

/** UI locales the frontend ships dictionaries for (docs/02, docs/08). */
export const SUPPORTED_LOCALES = ["zh-CN", "en"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "zh-CN";

export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}


/** Error codes are part of the public API contract (docs/02). */
export const ERROR_CODES = [
  "auth_required",
  "email_unverified",
  "forbidden",
  "not_found",
  "gone",
  "validation_error",
  "version_conflict",
  "edit_window_expired",
  "edit_locked",
  "captcha_failed",
  "captcha_unavailable",
  "rate_limited",
  "conflict",
  "maintenance",
  "internal_error",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type ApiMeta = Record<string, unknown>;

export type ApiSuccess<T> = {
  ok: true;
  data: T;
  meta?: ApiMeta;
};

export type ApiFailure = {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
    fields?: Record<string, string[]>;
  };
};

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export function ok<T>(data: T, meta?: ApiMeta): ApiSuccess<T> {
  return meta === undefined ? { ok: true, data } : { ok: true, data, meta };
}

export function fail(
  code: ErrorCode,
  message: string,
  fields?: Record<string, string[]>,
): ApiFailure {
  return {
    ok: false,
    error: fields === undefined ? { code, message } : { code, message, fields },
  };
}

export const healthSchema = z.object({
  status: z.literal("ok"),
  version: z.string(),
  environment: z.string(),
  db: z.boolean(),
  r2: z.boolean(),
  now: z.number().int().nonnegative(),
  configVersion: z.string(),
  turnstileConfigured: z.boolean(),
});

export type Health = z.infer<typeof healthSchema>;

// ---------------------------------------------------------------------------
// Settings contract (docs/02). Every group is validated independently so one
// bad admin value cannot discard the other groups' overrides.
// ---------------------------------------------------------------------------

const nonEmpty = z.string().trim().min(1).max(200);
const nullableKey = z.string().max(300).nullable();
const hexColor = z.string().regex(/^#[0-9a-fA-F]{3,8}$/);

export const siteConfigSchema = z.object({
  name: nonEmpty.default("Pineboard"),
  tagline: z.string().max(200).default(""),
  url: z.string().url().default("https://forum.example.com"),
  description: z.string().max(500).default(""),
  keywords: z.string().max(500).default(""),
  logoKey: nullableKey.default(null),
  faviconKey: nullableKey.default(null),
  ogImageKey: nullableKey.default(null),
  timezone: z.string().min(1).max(64).default("Asia/Shanghai"),
  /**
   * Site UI language: one value for the whole site. Visitors cannot switch; the
   * operator picks Chinese or English and every screen renders that language.
   * User content (topics, replies, category and tag names) is never translated.
   */
  language: z.enum(SUPPORTED_LOCALES).default(DEFAULT_LOCALE),
  icp: z.string().max(64).default(""),
  announcement: z
    .object({
      id: z.string().trim().max(64).default("default"),
      enabled: z.boolean().default(false),
      text: z.string().max(300).default(""),
      href: z.string().max(300).default(""),
    })
    .default({ id: "default", enabled: false, text: "", href: "" }),
});

export const seoConfigSchema = z.object({
  titleTemplate: z.string().max(200).default("{title} · {siteName}"),
  homeTitle: z.string().max(200).default(""),
  description: z.string().max(500).default(""),
  noindex: z.boolean().default(false),
  topicsPerPage: z.number().int().min(5).max(50).default(20),
  postsPerPage: z.number().int().min(5).max(50).default(20),
  sitemapEnabled: z.boolean().default(true),
});

export const accountConfigSchema = z.object({
  registrationOpen: z.boolean().default(true),
  allowUnverifiedLogin: z.boolean().default(true),
  requireVerificationForWrite: z.boolean().default(true),
  passwordMinLength: z.number().int().min(8).max(128).default(8),
  usernameMin: z.number().int().min(3).max(20).default(3),
  usernameMax: z.number().int().min(3).max(20).default(20),
  sessionDays: z.number().int().min(1).max(365).default(30),
  deletionGraceDays: z.number().int().min(0).max(90).default(7),
});

export const editConfigSchema = z.object({
  windowUserMinutes: z.number().int().min(0).default(60),
  windowModeratorMinutes: z.number().int().min(0).default(0),
  allowStaffEditOthers: z.boolean().default(true),
  lockAfterReply: z.boolean().default(false),
  allowSelfDelete: z.boolean().default(true),
  historyVisibility: z.enum(["public", "author", "staff"]).default("author"),
  keepRevisions: z.number().int().min(1).max(200).default(20),
  requireReason: z.boolean().default(false),
});

export const mailConfigSchema = z.object({
  enabled: z.boolean().default(true),
  fromName: z.string().max(100).default("论坛"),
  fromAddress: z.string().email().default("no-reply@mail.example.com"),
  replyTo: z.string().email().nullable().default(null),
  notifyTopicReply: z.boolean().default(true),
  notifyPostReply: z.boolean().default(true),
  notifyMention: z.boolean().default(true),
  notifyModeration: z.boolean().default(true),
  includeUnsubscribe: z.boolean().default(true),
  dailyBudget: z.number().int().min(0).max(1000).default(80),
  userDailyCap: z.number().int().min(0).max(100).default(10),
  digestWindowMinutes: z.number().int().min(5).max(60).default(10),
  verificationTtlMinutes: z.number().int().min(5).max(1440).default(60),
  resetTtlMinutes: z.number().int().min(5).max(1440).default(30),
  unsubscribeTokenDays: z.number().int().min(1).max(3650).default(180),
});

export const featureConfigSchema = z.object({
  turnstile: z.boolean().default(true),
  pwa: z.boolean().default(true),
  markdown: z.boolean().default(true),
  search: z.boolean().default(true),
  uploads: z.boolean().default(true),
  reports: z.boolean().default(true),
  guestRead: z.boolean().default(true),
});

export const maintenanceConfigSchema = z.object({
  enabled: z.boolean().default(false),
  message: z.string().max(500).default("站点维护中，请稍后再试。"),
  allowAdmin: z.boolean().default(true),
});

export const uploadConfigSchema = z.object({
  imageMaxMb: z.number().int().min(1).max(20).default(5),
  fileMaxMb: z.number().int().min(1).max(100).default(10),
  userDailyCount: z.number().int().min(1).max(200).default(20),
  orphanTtlHours: z.number().int().min(1).max(168).default(24),
});

export const securityConfigSchema = z.object({
  postMinIntervalSeconds: z.number().int().min(0).max(3600).default(30),
  newUserDailyPosts: z.number().int().min(0).max(100).default(10),
  mentionMaxPerPost: z.number().int().min(0).max(20).default(5),
  reportDailyLimit: z.number().int().min(0).max(100).default(10),
  /** Per-IP fixed window used before Turnstile siteverify (P1). */
  signupPerHour: z.number().int().min(1).max(1000).default(5),
});

/**
 * Non-secret service identifiers editable in the admin UI. Credentials live
 * in the encrypted `secrets` settings namespace, never in this object.
 */
export const integrationConfigSchema = z.object({
  cloudflare: z
    .object({
      accountId: z.string().trim().max(100).default(""),
      r2Bucket: z.string().trim().max(100).default(""),
      cdnUrl: z.string().trim().max(300).default(""),
      turnstileSiteKey: z.string().trim().max(200).default(""),
    })
    .default({ accountId: "", r2Bucket: "", cdnUrl: "", turnstileSiteKey: "" }),
});

export const themeConfigSchema = z.object({
  layout: z.enum(["classic", "compact", "card"]).default("classic"),
  tokens: z
    .record(
      z.string().regex(/^--[a-z0-9-]+$/),
      z.string().refine(
        (value) => !/(url\s*\(|expression|@import|javascript:)/i.test(value),
        "unsafe theme token value",
      ),
    )
    .default({}),
  darkMode: z.enum(["system", "light", "dark"]).default("system"),
});

export const configSchema = z.object({
  site: siteConfigSchema,
  seo: seoConfigSchema,
  account: accountConfigSchema,
  edit: editConfigSchema,
  mail: mailConfigSchema,
  feature: featureConfigSchema,
  maintenance: maintenanceConfigSchema,
  upload: uploadConfigSchema,
  security: securityConfigSchema,
  integration: integrationConfigSchema,
  theme: themeConfigSchema,
});

export type AppConfig = z.infer<typeof configSchema>;
export type ConfigGroup = keyof AppConfig;
export type DeepPartial<T> = T extends object
  ? { [K in keyof T]?: DeepPartial<T[K]> }
  : T;

export const configGroupSchemas = {
  site: siteConfigSchema,
  seo: seoConfigSchema,
  account: accountConfigSchema,
  edit: editConfigSchema,
  mail: mailConfigSchema,
  feature: featureConfigSchema,
  maintenance: maintenanceConfigSchema,
  upload: uploadConfigSchema,
  security: securityConfigSchema,
  integration: integrationConfigSchema,
  theme: themeConfigSchema,
} satisfies { [K in ConfigGroup]: z.ZodType<AppConfig[K]> };

export const DEFAULTS: AppConfig = {
  site: {
    name: "Pineboard",
    tagline: "轻量、专注讨论的社区",
    url: "https://forum.example.com",
    description: "一个轻量的讨论社区，适合任何想认真交流的小圈子。",
    keywords: "",
    logoKey: null,
    faviconKey: null,
    ogImageKey: null,
    timezone: "Asia/Shanghai",
    language: "zh-CN",
    icp: "",
    announcement: { id: "default", enabled: false, text: "", href: "" },
  },
  seo: {
    titleTemplate: "{title} · {siteName}",
    homeTitle: "",
    description: "",
    noindex: false,
    topicsPerPage: 20,
    postsPerPage: 20,
    sitemapEnabled: true,
  },
  account: {
    registrationOpen: true,
    allowUnverifiedLogin: true,
    requireVerificationForWrite: true,
    passwordMinLength: 8,
    usernameMin: 3,
    usernameMax: 20,
    sessionDays: 30,
    deletionGraceDays: 7,
  },
  edit: {
    windowUserMinutes: 60,
    windowModeratorMinutes: 0,
    allowStaffEditOthers: true,
    lockAfterReply: false,
    allowSelfDelete: true,
    historyVisibility: "author",
    keepRevisions: 20,
    requireReason: false,
  },
  mail: {
    enabled: true,
    fromName: "论坛",
    fromAddress: "no-reply@mail.example.com",
    replyTo: null,
    notifyTopicReply: true,
    notifyPostReply: true,
    notifyMention: true,
    notifyModeration: true,
    includeUnsubscribe: true,
    dailyBudget: 80,
    userDailyCap: 10,
    digestWindowMinutes: 10,
    verificationTtlMinutes: 60,
    resetTtlMinutes: 30,
    unsubscribeTokenDays: 180,
  },
  feature: {
    turnstile: true,
    pwa: true,
    markdown: true,
    search: true,
    uploads: true,
    reports: true,
    guestRead: true,
  },
  maintenance: {
    enabled: false,
    message: "站点维护中，请稍后再试。",
    allowAdmin: true,
  },
  upload: {
    imageMaxMb: 5,
    fileMaxMb: 10,
    userDailyCount: 20,
    orphanTtlHours: 24,
  },
  security: {
    postMinIntervalSeconds: 30,
    newUserDailyPosts: 10,
    mentionMaxPerPost: 5,
    reportDailyLimit: 10,
    signupPerHour: 5,
  },
  integration: {
    cloudflare: { accountId: "", r2Bucket: "", cdnUrl: "", turnstileSiteKey: "" },
  },
  theme: {
    layout: "classic",
    tokens: {},
    darkMode: "system",
  },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep merge for settings overrides; arrays and null replace the default. */
export function mergeDeep<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return (patch === undefined ? base : patch) as T;
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const current = result[key];
    result[key] = isPlainObject(current) && isPlainObject(value) ? mergeDeep(current, value) : value;
  }
  return result as T;
}

/**
 * Parse dotted settings rows into a validated config. Invalid groups fall back
 * to DEFAULTS individually and are reported instead of being silently used.
 */
export function parseConfigOverrides(raw: Record<string, unknown>): {
  config: AppConfig;
  errors: { group: ConfigGroup; message: string }[];
} {
  const errors: { group: ConfigGroup; message: string }[] = [];
  const config = structuredClone(DEFAULTS);
  for (const group of Object.keys(DEFAULTS) as ConfigGroup[]) {
    const candidate = mergeDeep(DEFAULTS[group], raw[group]);
    const parsed = configGroupSchemas[group].safeParse(candidate);
    if (parsed.success) {
      // The per-group schemas are structurally equivalent to the full schema.
      (config as Record<ConfigGroup, unknown>)[group] = parsed.data;
    } else {
      errors.push({ group, message: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") });
    }
  }
  return { config, errors };
}

export function flattenConfigPatch(
  patch: DeepPartial<AppConfig>,
  prefix = "",
): { path: string; group: ConfigGroup; value: unknown }[] {
  const result: { path: string; group: ConfigGroup; value: unknown }[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    const group = (prefix ? prefix.split(".")[0] : key) as ConfigGroup;
    if (isPlainObject(value)) {
      result.push(...flattenConfigPatch(value as DeepPartial<AppConfig>, path));
    } else {
      result.push({ path, group, value });
    }
  }
  return result;
}

export const publicConfigSchema = z.object({
  site: z.object({
    name: z.string(),
    tagline: z.string(),
    url: z.string(),
    description: z.string(),
    keywords: z.string(),
    logoKey: z.string().nullable(),
    faviconKey: z.string().nullable(),
    ogImageKey: z.string().nullable(),
    timezone: z.string(),
    language: z.string(),
    icp: z.string(),
    announcement: z.object({ id: z.string(), enabled: z.boolean(), text: z.string(), href: z.string() }),
  }),
  seo: z.object({
    homeTitle: z.string(),
    description: z.string(),
    noindex: z.boolean(),
    topicsPerPage: z.number().int(),
    postsPerPage: z.number().int(),
  }),
  account: z.object({
    registrationOpen: z.boolean(),
    allowUnverifiedLogin: z.boolean(),
    requireVerificationForWrite: z.boolean(),
    passwordMinLength: z.number().int(),
    usernameMin: z.number().int(),
    usernameMax: z.number().int(),
  }),
  feature: z.object({
    turnstile: z.boolean(),
    pwa: z.boolean(),
    markdown: z.boolean(),
    search: z.boolean(),
    uploads: z.boolean(),
    reports: z.boolean(),
    guestRead: z.boolean(),
  }),
  maintenance: z.object({
    enabled: z.boolean(),
    message: z.string(),
  }),
  upload: z.object({
    imageMaxMb: z.number().int(),
    fileMaxMb: z.number().int(),
    imageTypes: z.array(z.string()),
    attachmentTypes: z.array(z.string()),
  }),
  theme: z.object({
    layout: z.string(),
    tokens: z.record(z.string(), z.string()),
    darkMode: z.string(),
  }),
  turnstileSiteKey: z.string(),
  version: z.string(),
});

export type PublicConfig = z.infer<typeof publicConfigSchema>;

export function toPublicConfig(config: AppConfig, version: number, turnstileSiteKey: string): PublicConfig {
  return {
    site: config.site,
    seo: {
      homeTitle: config.seo.homeTitle,
      description: config.seo.description,
      noindex: config.seo.noindex,
      topicsPerPage: config.seo.topicsPerPage,
      postsPerPage: config.seo.postsPerPage,
    },
    account: {
      registrationOpen: config.account.registrationOpen,
      allowUnverifiedLogin: config.account.allowUnverifiedLogin,
      requireVerificationForWrite: config.account.requireVerificationForWrite,
      passwordMinLength: config.account.passwordMinLength,
      usernameMin: config.account.usernameMin,
      usernameMax: config.account.usernameMax,
    },
    feature: {
      ...config.feature,
      turnstile: config.feature.turnstile && Boolean(turnstileSiteKey),
    },
    maintenance: {
      enabled: config.maintenance.enabled,
      message: config.maintenance.message,
    },
    upload: {
      imageMaxMb: config.upload.imageMaxMb,
      fileMaxMb: config.upload.fileMaxMb,
      imageTypes: [...UPLOAD_IMAGE_MIME],
      attachmentTypes: [...UPLOAD_ARCHIVE_MIME],
    },
    theme: config.theme,
    turnstileSiteKey,
    version: String(version),
  };
}

// ---------------------------------------------------------------------------
// Client-side password derivation contract (docs/03). The salt is the
// normalized email, so changing email requires a password reset.
// ---------------------------------------------------------------------------

export const DERIVED_PASSWORD_RE = /^v1\$[A-Za-z0-9+/=]{43,}$/;

export async function derivePassword(email: string, password: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = encoder.encode(`forum:v1:${email.trim().toLowerCase()}`);
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 310_000 },
    key,
    256,
  );
  return "v1$" + btoa(String.fromCharCode(...new Uint8Array(bits)));
}

export async function hmacB64(pepper: string, value: string): Promise<string> {
  const encoder = new TextEncoder();
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

export function timingSafeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.min(left.length, right.length); i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** ULID for forum-owned rows and Better Auth IDs (docs/02). */
export function ulid(now = Date.now()): string {
  let time = Math.floor(now);
  const chars = new Array<string>(26);
  for (let i = 9; i >= 0; i--) {
    chars[i] = ULID_ALPHABET[time % 32]!;
    time = Math.floor(time / 32);
  }
  const random = crypto.getRandomValues(new Uint8Array(16));
  for (let i = 0; i < 16; i++) chars[10 + i] = ULID_ALPHABET[random[i]! % 32]!;
  return chars.join("");
}

export const currentUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  image: z.string().nullable(),
  username: z.string().nullable(),
  role: z.enum(["user", "moderator", "admin"]),
  status: z.enum(["active", "suspended", "deleting", "deleted"]),
  bio: z.string().nullable(),
  avatarKey: z.string().nullable(),
  timezone: z.string().nullable(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export const meSchema = z.object({
  user: currentUserSchema,
  permissions: z.object({
    canWrite: z.boolean(),
    isAdmin: z.boolean(),
    isModerator: z.boolean(),
  }),
  configVersion: z.string(),
});

export type CurrentUser = z.infer<typeof currentUserSchema>;
export type Me = z.infer<typeof meSchema>;
