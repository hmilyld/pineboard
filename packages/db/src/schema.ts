import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * Key-value settings with a per-group cache domain (docs/02). Values are JSON;
 * code-side DEFAULTS and Zod validation live in @pineboard/shared.
 */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
  groupName: text("group_name").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  updatedBy: text("updated_by"),
  version: integer("version").notNull().default(1),
});

// Better Auth core tables. Drizzle property names are camelCase because Better
// Auth looks them up by property; physical columns stay snake_case.
export const user = sqliteTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    // The SQL migration declares COLLATE NOCASE; Drizzle SQLite has no collate API.
    email: text("email").notNull(),
    emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
    image: text("image"),
    username: text("username"),
    role: text("role").notNull().default("user"),
    status: text("status").notNull().default("active"),
    bio: text("bio"),
    avatarKey: text("avatar_key"),
    timezone: text("timezone"),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp" }),
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("user_email_unique").on(table.email),
    uniqueIndex("user_username_unique").on(table.username),
    check("user_role_check", sql`${table.role} in ('user','moderator','admin')`),
    check("user_status_check", sql`${table.status} in ('active','suspended','deleting','deleted')`),
  ],
);

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    token: text("token").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("session_token_unique").on(table.token),
    index("session_user_id_idx").on(table.userId),
    index("session_expires_at_idx").on(table.expiresAt),
  ],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("account_provider_unique").on(table.providerId, table.accountId),
    index("account_user_id_idx").on(table.userId),
  ],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }),
    updatedAt: integer("updated_at", { mode: "timestamp" }),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const rateLimit = sqliteTable(
  "rateLimit",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    count: integer("count").notNull(),
    lastRequest: integer("last_request").notNull(),
  },
  (table) => [uniqueIndex("rate_limit_key_unique").on(table.key)],
);

/** Fixed-window limits owned by our API (Turnstile order, posts, reports). */
export const rateLimits = sqliteTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: integer("window_start").notNull(),
    count: integer("count").notNull(),
  },
  (table) => [primaryKey({ columns: [table.key, table.windowStart] })],
);

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metaJson: text("meta_json"),
    ipHash: text("ip_hash"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("audit_logs_target_idx").on(table.targetType, table.targetId),
    index("audit_logs_created_idx").on(table.createdAt),
  ],
);

export const emailLogs = sqliteTable(
  "email_logs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id"),
    toEmail: text("to_email").notNull(),
    category: text("category").notNull(),
    template: text("template").notNull(),
    status: text("status").notNull(),
    providerId: text("provider_id"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    attempts: integer("attempts").notNull().default(0),
    notificationId: text("notification_id"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    sentAt: integer("sent_at", { mode: "timestamp" }),
  },
  (table) => [
    index("email_logs_created_idx").on(table.createdAt),
    index("email_logs_status_idx").on(table.status, table.createdAt),
    index("email_logs_to_email_idx").on(table.toEmail),
  ],
);

/**
 * Development-only outbox used when EMAIL_TRANSPORT=log and the environment is
 * not production. It lets local/staging tests retrieve verification/reset
 * links without a real Resend key. Production code never writes here.
 */
export const devEmailOutbox = sqliteTable("dev_email_outbox", {
  id: text("id").primaryKey(),
  toEmail: text("to_email").notNull(),
  category: text("category").notNull(),
  payloadJson: text("payload_json").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export type Setting = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;
export type User = typeof user.$inferSelect;
export type Session = typeof session.$inferSelect;
export type Account = typeof account.$inferSelect;


// ---------------------------------------------------------------------------
// P2 forum content
// ---------------------------------------------------------------------------

export const categories = sqliteTable(
  "categories",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    color: text("color").notNull().default("#14513f"),
    sortOrder: integer("sort_order").notNull().default(0),
    isVisible: integer("is_visible", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("categories_slug_unique").on(table.slug),
    index("categories_visible_order_idx").on(table.isVisible, table.sortOrder),
  ],
);

/**
 * Top navigation is admin-maintained. `kind = 'categories'` renders the
 * built-in category dropdown; every other row is a plain link.
 */
export const navItems = sqliteTable(
  "nav_items",
  {
    id: text("id").primaryKey(),
    label: text("label").notNull(),
    href: text("href").notNull().default(""),
    kind: text("kind").notNull().default("link"),
    parentId: text("parent_id"),
    sortOrder: integer("sort_order").notNull().default(0),
    isVisible: integer("is_visible", { mode: "boolean" }).notNull().default(true),
    openInNewTab: integer("open_in_new_tab", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("nav_items_visible_order_idx").on(table.isVisible, table.sortOrder),
    check("nav_items_kind_check", sql`${table.kind} in ('link','categories','dropdown')`),
  ],
);

export const categoryModerators = sqliteTable(
  "category_moderators",
  {
    categoryId: text("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.categoryId, table.userId] })],
);

export const tags = sqliteTable(
  "tags",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    color: text("color").notNull().default("#71717a"),
    usageCount: integer("usage_count").notNull().default(0),
    status: text("status").notNull().default("active"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("tags_slug_unique").on(table.slug),
    index("tags_status_idx").on(table.status),
    check("tags_status_check", sql`${table.status} in ('active','hidden','merged')`),
  ],
);

export const topics = sqliteTable(
  "topics",
  {
    id: text("id").primaryKey(),
    categoryId: text("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    firstPostId: text("first_post_id"),
    status: text("status").notNull().default("published"),
    pinLevel: integer("pin_level").notNull().default(0),
    pinOrder: integer("pin_order").notNull().default(0),
    isLocked: integer("is_locked", { mode: "boolean" }).notNull().default(false),
    isDigest: integer("is_digest", { mode: "boolean" }).notNull().default(false),
    replyCount: integer("reply_count").notNull().default(0),
    likeCount: integer("like_count").notNull().default(0),
    viewCount: integer("view_count").notNull().default(0),
    lastPostAt: integer("last_post_at", { mode: "timestamp" }).notNull(),
    lastPostUserId: text("last_post_user_id"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
    deletedBy: text("deleted_by"),
  },
  (table) => [
    index("topics_list_idx").on(table.status, table.pinLevel, table.pinOrder, table.lastPostAt),
    index("topics_category_idx").on(table.status, table.categoryId, table.pinLevel, table.lastPostAt),
    index("topics_author_idx").on(table.authorId, table.createdAt),
    index("topics_digest_idx").on(table.status, table.isDigest, table.lastPostAt),
    check("topics_pin_check", sql`${table.pinLevel} in (0,1,2)`),
    check("topics_status_check", sql`${table.status} in ('published','hidden','deleted','pending','rejected')`),
  ],
);

export const posts = sqliteTable(
  "posts",
  {
    id: text("id").primaryKey(),
    topicId: text("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "restrict" }),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    parentPostId: text("parent_post_id"),
    floor: integer("floor").notNull(),
    isFirst: integer("is_first", { mode: "boolean" }).notNull().default(false),
    title: text("title"),
    contentMd: text("content_md").notNull(),
    contentText: text("content_text").notNull(),
    status: text("status").notNull().default("published"),
    likeCount: integer("like_count").notNull().default(0),
    version: integer("version").notNull().default(1),
    editCount: integer("edit_count").notNull().default(0),
    editedAt: integer("edited_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
    deletedBy: text("deleted_by"),
  },
  (table) => [
    uniqueIndex("posts_topic_floor_unique").on(table.topicId, table.floor),
    index("posts_topic_idx").on(table.topicId, table.status, table.floor),
    index("posts_author_idx").on(table.authorId, table.createdAt),
    index("posts_parent_idx").on(table.parentPostId),
    check("posts_status_check", sql`${table.status} in ('published','hidden','deleted','pending','rejected')`),
  ],
);

export const topicTags = sqliteTable(
  "topic_tags",
  {
    topicId: text("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.topicId, table.tagId] }),
    index("topic_tags_tag_idx").on(table.tagId),
  ],
);

export const postLikes = sqliteTable(
  "post_likes",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.postId] }), index("post_likes_post_idx").on(table.postId)],
);

export const bookmarks = sqliteTable(
  "bookmarks",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    topicId: text("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.topicId] }),
    index("bookmarks_user_idx").on(table.userId, table.createdAt),
  ],
);



export const postRevisions = sqliteTable(
  "post_revisions",
  {
    id: text("id").primaryKey(),
    topicId: text("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    title: text("title"),
    contentMd: text("content_md").notNull(),
    action: text("action").notNull(),
    editorId: text("editor_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    reason: text("reason"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("post_revisions_post_version_unique").on(table.postId, table.version),
    index("post_revisions_post_idx").on(table.postId, table.version),
    check("post_revisions_action_check", sql`${table.action} in ('edit','delete','restore')`),
  ],
);



export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    actorId: text("actor_id"),
    topicId: text("topic_id").notNull(),
    postId: text("post_id"),
    title: text("title").notNull(),
    snippet: text("snippet").notNull().default(""),
    readAt: integer("read_at", { mode: "timestamp" }),
    emailStatus: text("email_status").notNull().default("pending"),
    emailBatchKey: text("email_batch_key"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("notifications_user_idx").on(table.userId, table.readAt, table.createdAt),
    index("notifications_email_idx").on(table.emailStatus, table.createdAt),
    check(
      "notifications_type_check",
      sql`${table.type} in ('topic_reply','post_reply','mention','moderation','system')`,
    ),
    check(
      "notifications_email_status_check",
      sql`${table.emailStatus} in ('pending','sent','skipped','failed')`,
    ),
  ],
);

export const notificationPreferences = sqliteTable(
  "notification_preferences",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    emailEnabled: integer("email_enabled", { mode: "boolean" }).notNull().default(false),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.category] }),
    check(
      "notification_preferences_category_check",
      sql`${table.category} in ('topic_reply','post_reply','mention','moderation')`,
    ),
  ],
);

export const emailUnsubscribeTokens = sqliteTable(
  "email_unsubscribe_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    tokenHash: text("token_hash").notNull(),
    version: integer("version").notNull().default(1),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    usedAt: integer("used_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("email_unsubscribe_token_hash_unique").on(table.tokenHash),
    index("email_unsubscribe_user_idx").on(table.userId, table.category),
  ],
);

export const emailSuppressions = sqliteTable("email_suppressions", {
  email: text("email").primaryKey(),
  reason: text("reason").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});



export const reports = sqliteTable(
  "reports",
  {
    id: text("id").primaryKey(),
    reporterId: text("reporter_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    categoryId: text("category_id"),
    topicId: text("topic_id"),
    postId: text("post_id"),
    targetTitle: text("target_title"),
    targetSnippet: text("target_snippet"),
    reasonCode: text("reason_code").notNull(),
    detail: text("detail").notNull().default(""),
    status: text("status").notNull().default("pending"),
    handledBy: text("handled_by"),
    handledAt: integer("handled_at", { mode: "timestamp" }),
    resolutionNote: text("resolution_note"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("reports_status_idx").on(table.status, table.createdAt),
    index("reports_category_idx").on(table.categoryId, table.status, table.createdAt),
    uniqueIndex("reports_pending_unique")
      .on(table.reporterId, table.targetType, table.targetId)
      .where(sql`${table.status} = 'pending'`),
    check("reports_target_type_check", sql`${table.targetType} in ('topic','post')`),
    check("reports_status_check", sql`${table.status} in ('pending','resolved','dismissed')`),
    check(
      "reports_reason_check",
      sql`${table.reasonCode} in ('spam','abuse','illegal','off_topic','other')`,
    ),
  ],
);

export const schema = {
  settings,
  user,
  session,
  account,
  verification,
  rateLimit,
  rateLimits,
  auditLogs,
  emailLogs,
  devEmailOutbox,
  categories,
  categoryModerators,
  tags,
  topicTags,
  topics,
  posts,
  postLikes,
  bookmarks,
  postRevisions,
  notifications,
  notificationPreferences,
  emailUnsubscribeTokens,
  emailSuppressions,
  reports,
};
