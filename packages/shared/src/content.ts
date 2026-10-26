import { z } from "zod";

export const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug 只能包含小写字母、数字和短横线");

export const topicSortSchema = z.enum(["latest", "new", "hot"]);
export type TopicSort = z.infer<typeof topicSortSchema>;

export const createTopicSchema = z.object({
  categoryId: z.string().min(1).max(64),
  title: z.string().trim().min(1, "请输入标题").max(120, "标题最多 120 字"),
  contentMd: z.string().min(1, "请输入正文").max(32 * 1024, "正文最多 32KB"),
  tagIds: z.array(z.string().min(1).max(64)).max(5, "标签最多 5 个").default([]),
});

export type CreateTopicInput = z.infer<typeof createTopicSchema>;

export const createPostSchema = z.object({
  contentMd: z.string().min(1, "请输入回复内容").max(32 * 1024, "回复最多 32KB"),
  parentPostId: z.string().min(1).max(64).optional(),
});

export type CreatePostInput = z.infer<typeof createPostSchema>;

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  perPage: z.coerce.number().int().min(5).max(50).default(20),
});

export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[*_~>#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function excerpt(text: string, max = 160): string {
  const normalized = markdownToPlainText(text);
  return normalized.length <= max ? normalized : normalized.slice(0, max).trimEnd() + "…";
}

export const authorSummarySchema = z.object({
  id: z.string(),
  username: z.string().nullable(),
  name: z.string(),
  avatarKey: z.string().nullable(),
});

export type AuthorSummary = z.infer<typeof authorSummarySchema>;

export const recentTopicSchema = z.object({ id: z.string(), title: z.string() });

export const tagSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().optional(),
  color: z.string(),
  usageCount: z.number().int().nonnegative(),
  topicCount: z.number().int().nonnegative().optional(),
  recentTopic: recentTopicSchema.nullable().optional(),
});

export type Tag = z.infer<typeof tagSchema>;

export const categoryStatsSchema = z.object({
  topics: z.number().int().nonnegative(),
  todayTopics: z.number().int().nonnegative(),
  replies: z.number().int().nonnegative(),
});

export const categorySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  color: z.string(),
  sortOrder: z.number().int(),
  isVisible: z.boolean(),
  topicCount: z.number().int().nonnegative().optional(),
  todayTopics: z.number().int().nonnegative().optional(),
  replies: z.number().int().nonnegative().optional(),
  stats: categoryStatsSchema.optional(),
  recentTopic: recentTopicSchema.nullable().optional(),
});

export type Category = z.infer<typeof categorySchema>;

export const topicSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  pinLevel: z.number().int(),
  isDigest: z.boolean(),
  isLocked: z.boolean(),
  replyCount: z.number().int(),
  likeCount: z.number().int(),
  viewCount: z.number().int(),
  createdAt: z.number().int(),
  lastPostAt: z.number().int(),
  category: categorySchema.pick({ id: true, slug: true, name: true, color: true }),
  author: authorSummarySchema,
  lastPostUser: authorSummarySchema.nullable(),
  tags: z.array(tagSchema),
});

export type TopicSummary = z.infer<typeof topicSummarySchema>;

export const postSchema = z.object({
  id: z.string(),
  topicId: z.string(),
  author: authorSummarySchema,
  parentPostId: z.string().nullable(),
  floor: z.number().int(),
  isFirst: z.boolean(),
  title: z.string().nullable(),
  contentMd: z.string(),
  contentText: z.string(),
  status: z.string(),
  likeCount: z.number().int(),
  version: z.number().int(),
  editCount: z.number().int(),
  editedAt: z.number().int().nullable(),
  createdAt: z.number().int(),
  deletedAt: z.number().int().nullable(),
  likedByMe: z.boolean(),
});

export type Post = z.infer<typeof postSchema>;

export const topicDetailSchema = z.object({
  topic: topicSummarySchema,
  firstPost: postSchema,
  viewer: z.object({
    canReply: z.boolean(),
    canEdit: z.boolean(),
    canDelete: z.boolean(),
    canModerate: z.boolean(),
    canViewHistory: z.boolean(),
    liked: z.boolean(),
    bookmarked: z.boolean(),
  }),
});

export type TopicDetail = z.infer<typeof topicDetailSchema>;

export const topicListSchema = z.object({
  items: z.array(topicSummarySchema),
  page: z.number().int(),
  perPage: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
});

export type TopicList = z.infer<typeof topicListSchema>;

export const postListSchema = z.object({
  items: z.array(postSchema),
  nextCursor: z.number().int().nullable(),
});

export type PostList = z.infer<typeof postListSchema>;

export const postPageSchema = z.object({
  items: z.array(postSchema),
  page: z.number().int(),
  perPage: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
  onlyOp: z.boolean(),
  nextCursor: z.number().int().nullable().optional(),
});

export type PostPage = z.infer<typeof postPageSchema>;

export const siteStatsSchema = z.object({
  todayPosts: z.number().int().nonnegative(),
  topics: z.number().int().nonnegative(),
  replies: z.number().int().nonnegative(),
  members: z.number().int().nonnegative(),
});

export type SiteStats = z.infer<typeof siteStatsSchema>;

export const tagDetailSchema = tagSchema.extend({
  description: z.string(),
  stats: z.object({
    topics: z.number().int().nonnegative(),
    todayTopics: z.number().int().nonnegative(),
    replies: z.number().int().nonnegative(),
  }),
});

export type TagDetail = z.infer<typeof tagDetailSchema>;

export const editPostSchema = z
  .object({
    version: z.number().int().min(1),
    title: z.string().trim().min(1).max(120).optional(),
    contentMd: z.string().min(1).max(32 * 1024).optional(),
    reason: z.string().trim().max(200).optional(),
  })
  .refine((value) => value.title !== undefined || value.contentMd !== undefined, {
    message: "至少修改标题或正文",
  });

export type EditPostInput = z.infer<typeof editPostSchema>;

export const pinTopicSchema = z.object({
  pinLevel: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  pinOrder: z.number().int().min(0).max(9999).optional(),
});

export const lockTopicSchema = z.object({
  locked: z.boolean(),
});

export const moveTopicSchema = z.object({
  categoryId: z.string().min(1).max(64),
});

export const revisionSchema = z.object({
  id: z.string(),
  version: z.number().int(),
  title: z.string().nullable(),
  contentMd: z.string(),
  action: z.enum(["edit", "delete", "restore"]),
  editor: z.object({ id: z.string(), name: z.string(), username: z.string().nullable() }),
  reason: z.string().nullable(),
  createdAt: z.number().int(),
});

export type Revision = z.infer<typeof revisionSchema>;

const ZERO_WIDTH = /[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g;
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

export function normalizeForSearch(input: string): string {
  return markdownToPlainText(input)
    .normalize("NFKC")
    .replace(ZERO_WIDTH, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * CJK bigrams + whole ASCII words. Duplicates are intentionally preserved:
 * removing them breaks phrase adjacency for repeated terms.
 */
export function bigramTokens(input: string): string {
  const normalized = normalizeForSearch(input);
  if (!normalized) return "";
  const tokens: string[] = [];
  for (const run of normalized.split(" ")) {
    if (!run) continue;
    if (!CJK.test(run)) {
      tokens.push(run);
      continue;
    }
    if (run.length === 1) {
      tokens.push(run);
      continue;
    }
    for (let i = 0; i < run.length - 1; i++) tokens.push(run.slice(i, i + 2));
  }
  return tokens.join(" ");
}

export function needsLikeFallback(input: string): boolean {
  const normalized = normalizeForSearch(input);
  return normalized.length === 1 && CJK.test(normalized);
}

export function likePattern(input: string): string {
  return `%${input.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export function ftsPhrase(tokens: string): string {
  return `"${tokens.replace(/"/g, '""')}"`;
}

export const searchSortSchema = z.enum(["relevance", "latest"]);
export type SearchSort = z.infer<typeof searchSortSchema>;

export const searchResultSchema = z.object({
  postId: z.string(),
  topicId: z.string(),
  topicTitle: z.string(),
  floor: z.number().int(),
  snippet: z.string(),
  author: authorSummarySchema,
  category: categorySchema.pick({ id: true, slug: true, name: true, color: true }),
  createdAt: z.number().int(),
});

export type SearchResult = z.infer<typeof searchResultSchema>;

export const searchResponseSchema = z.object({
  q: z.string(),
  mode: z.enum(["fts", "like"]),
  sort: searchSortSchema,
  items: z.array(searchResultSchema),
  page: z.number().int(),
  perPage: z.number().int(),
  total: z.number().int(),
});

export type SearchResponse = z.infer<typeof searchResponseSchema>;

export const REPORT_REASONS = ["spam", "abuse", "illegal", "off_topic", "other"] as const;

export const createReportSchema = z.object({
  targetType: z.enum(["topic", "post"]),
  targetId: z.string().min(1).max(64),
  reasonCode: z.enum(REPORT_REASONS),
  detail: z.string().trim().max(1000).default(""),
});

export type CreateReportInput = z.infer<typeof createReportSchema>;

export const resolveReportSchema = z.object({
  status: z.enum(["resolved", "dismissed"]),
  resolutionNote: z.string().trim().max(500).default(""),
});

export const digestTopicSchema = z.object({ isDigest: z.boolean() });

export const adminOverviewSchema = z.object({
  todayPosts: z.number().int().nonnegative(),
  pendingReports: z.number().int().nonnegative(),
  newMembersWeek: z.number().int().nonnegative(),
  emailFailures: z.number().int().nonnegative(),
  configVersion: z.string(),
  lastDeployAt: z.number().int().nullable(),
  jobs: z.record(z.string(), z.number().int().nullable()).optional(),
  pendingReportItems: z.array(
    z.object({
      id: z.string(),
      reasonCode: z.string(),
      targetType: z.string(),
      targetId: z.string(),
      targetTitle: z.string(),
      reporterName: z.string(),
      createdAt: z.number().int(),
    }),
  ),
});

export type AdminOverview = z.infer<typeof adminOverviewSchema>;

export const deleteAccountSchema = z.object({
  password: z.string().regex(/^v1\$[A-Za-z0-9+/=]{43,}$/, "密码必须由浏览器端派生"),
});
