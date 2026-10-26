import { z } from "zod";
import { categorySchema, slugSchema } from "./content";
import { integrationConfigSchema } from "./config";

// ---------------------------------------------------------------------------
// Admin: categories
// ---------------------------------------------------------------------------

export const categoryInputSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1, "请输入版块名称").max(40, "版块名称最多 40 字"),
  description: z.string().trim().max(200, "版块说明最多 200 字").default(""),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "颜色需为 #rrggbb")
    .default("#14513f"),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
  isVisible: z.boolean().default(true),
});

export type CategoryInput = z.infer<typeof categoryInputSchema>;

export const categoryModeratorSchema = z.object({
  id: z.string(),
  username: z.string().nullable(),
  name: z.string(),
  role: z.enum(["user", "moderator", "admin"]),
});

export type CategoryModerator = z.infer<typeof categoryModeratorSchema>;

export const adminCategorySchema = categorySchema.extend({
  topicCount: z.number().int().nonnegative(),
  createdAt: z.number().int(),
  moderators: z.array(categoryModeratorSchema).default([]),
});

export const categoryModeratorInputSchema = z.object({
  username: z.string().trim().min(1, "请输入用户名或邮箱").max(254),
});

export type CategoryModeratorInput = z.infer<typeof categoryModeratorInputSchema>;

export type AdminCategory = z.infer<typeof adminCategorySchema>;

// ---------------------------------------------------------------------------
// Admin: tags
// ---------------------------------------------------------------------------

export const tagStatusSchema = z.enum(["active", "hidden", "merged"]);
export type TagStatus = z.infer<typeof tagStatusSchema>;

export const tagInputSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1, "请输入标签名称").max(30, "标签名称最多 30 字"),
  description: z.string().trim().max(200, "标签说明最多 200 字").default(""),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "颜色需为 #rrggbb")
    .default("#71717a"),
  status: tagStatusSchema.default("active"),
});

export type TagInput = z.infer<typeof tagInputSchema>;

export const adminTagSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  color: z.string(),
  usageCount: z.number().int().nonnegative(),
  status: tagStatusSchema,
  topicCount: z.number().int().nonnegative(),
  createdAt: z.number().int(),
});

export type AdminTag = z.infer<typeof adminTagSchema>;

// ---------------------------------------------------------------------------
// Admin: top navigation
// ---------------------------------------------------------------------------

export const navKindSchema = z.enum(["link", "categories", "dropdown"]);
export type NavKind = z.infer<typeof navKindSchema>;

export type NavItem = {
  id: string;
  label: string;
  href: string;
  kind: NavKind;
  sortOrder: number;
  isVisible: boolean;
  openInNewTab: boolean;
  parentId: string | null;
  children?: NavItem[];
};

export const navItemSchema: z.ZodType<NavItem> = z.lazy(() =>
  z.object({
    id: z.string(),
    label: z.string(),
    href: z.string(),
    kind: navKindSchema,
    sortOrder: z.number().int(),
    isVisible: z.boolean(),
    openInNewTab: z.boolean(),
    parentId: z.string().nullable(),
    children: z.array(navItemSchema).optional(),
  }),
);

const internalPathRe = /^\/(?!\/)/;
const externalUrlRe = /^https?:\/\/[^\s]+$/i;

export const navItemInputSchema = z
  .object({
    label: z.string().trim().min(1, "请输入导航名称").max(20, "导航名称最多 20 字"),
    href: z.string().trim().max(300, "链接最多 300 字符").default(""),
    kind: navKindSchema.default("link"),
    parentId: z.string().max(64).nullable().optional(),
    sortOrder: z.number().int().min(0).max(10_000).default(0),
    isVisible: z.boolean().default(true),
    openInNewTab: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.kind !== "link") return;
    if (!value.href) {
      ctx.addIssue({ code: "custom", path: ["href"], message: "请输入链接地址" });
      return;
    }
    if (!internalPathRe.test(value.href) && !externalUrlRe.test(value.href)) {
      ctx.addIssue({ code: "custom", path: ["href"], message: "链接需以 / 开头，或为 http(s) 地址" });
    }
  });

export type NavItemInput = z.infer<typeof navItemInputSchema>;

export const reorderSchema = z.object({
  ids: z.array(z.string().min(1).max(64)).min(1).max(100),
});

// ---------------------------------------------------------------------------
// Admin: integrations (non-secret config + secret status only)
// ---------------------------------------------------------------------------

export const INTEGRATION_SECRET_NAMES = [
  "resendApiKey",
  "resendWebhookSecret",
  "turnstileSecret",
  "r2AccessKeyId",
  "r2SecretAccessKey",
] as const;

export type IntegrationSecretName = (typeof INTEGRATION_SECRET_NAMES)[number];

export const integrationSecretStatusSchema = z.object({
  configured: z.boolean(),
  source: z.enum(["database", "environment", "missing"]),
  updatedAt: z.number().int().nullable(),
});

export type IntegrationSecretStatus = z.infer<typeof integrationSecretStatusSchema>;

export const adminIntegrationsSchema = z.object({
  version: z.string(),
  config: integrationConfigSchema,
  effective: z.object({
    cloudflare: z.object({
      accountId: z.string(),
      r2Bucket: z.string(),
      cdnUrl: z.string(),
      turnstileSiteKey: z.string(),
    }),
  }),
  secrets: z.record(z.enum(INTEGRATION_SECRET_NAMES), integrationSecretStatusSchema),
});

export type AdminIntegrations = z.infer<typeof adminIntegrationsSchema>;

export const integrationSecretPatchSchema = z
  .object({
    resendApiKey: z.string().trim().min(1).max(500).nullable().optional(),
    resendWebhookSecret: z.string().trim().min(1).max(500).nullable().optional(),
    turnstileSecret: z.string().trim().min(1).max(500).nullable().optional(),
    r2AccessKeyId: z.string().trim().min(1).max(500).nullable().optional(),
    r2SecretAccessKey: z.string().trim().min(1).max(500).nullable().optional(),
  })
  .strict();

export type IntegrationSecretPatch = z.infer<typeof integrationSecretPatchSchema>;

/** No defaults: omitted keys must not wipe existing settings. */
export const integrationPatchSchema = z
  .object({
    cloudflare: z
      .object({
        accountId: z.string().trim().max(100).optional(),
        r2Bucket: z.string().trim().max(100).optional(),
        cdnUrl: z.string().trim().max(300).optional(),
        turnstileSiteKey: z.string().trim().max(200).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type IntegrationPatch = z.infer<typeof integrationPatchSchema>;

export const adminIntegrationsPatchSchema = z
  .object({
    version: z.number().int().nonnegative().optional(),
    integration: integrationPatchSchema.optional(),
    secrets: integrationSecretPatchSchema.optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Admin: users
// ---------------------------------------------------------------------------

export const adminUserRoleSchema = z.enum(["user", "moderator", "admin"]);
export const adminUserStatusSchema = z.enum(["active", "suspended", "deleting", "deleted"]);

export const adminUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  username: z.string().nullable(),
  role: adminUserRoleSchema,
  status: adminUserStatusSchema,
  emailVerified: z.boolean(),
  createdAt: z.number().int(),
  topicCount: z.number().int().nonnegative(),
  replyCount: z.number().int().nonnegative(),
});
export type AdminUser = z.infer<typeof adminUserSchema>;

export const adminUserUpdateSchema = z.object({ role: adminUserRoleSchema }).strict();
export const adminUserSuspendSchema = z.object({ reason: z.string().trim().max(300).default("") }).strict();
