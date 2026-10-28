import {
  healthSchema,
  meSchema,
  publicConfigSchema,
  type AdminCategory,
  type AdminIntegrations,
  type AdminTag,
  type AppConfig,
  type Category,
  type CreatePostInput,
  type CategoryInput,
  type CreateTopicInput,
  type DeepPartial,
  type EditPostInput,
  type Health,
  type Me,
  type NavItem,
  type NavItemInput,
  type PendingReviewItem,
  type PostPage,
  type PublicConfig,
  type ReviewDecisionInput,
  type Revision,
  type AdminOverview,
  type SearchResponse,
  type SearchSort,
  type SiteStats,
  type Tag,
  type TagDetail,
  type TagInput,
  type TopicDetail,
  type TopicList,
  type TopicSort,
  type UploadCompleteInput,
  type UploadKind,
  type UploadResult,
  type UploadSignInput,
  type ApiEnvelope,
} from "@pineboard/shared";
import { t } from "@/i18n";

export class ApiClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly fields?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function throwApiError(response: Response, body: unknown): never {
  if (body && typeof body === "object" && "ok" in body && (body as { ok: boolean }).ok === false) {
    const error = (body as unknown as { error: { code: string; message: string; fields?: Record<string, string[]> } }).error;
    throw new ApiClientError(error.code, error.message, response.status, error.fields);
  }
  if (body && typeof body === "object" && "message" in body) {
    const error = body as { message: string; code?: string };
    throw new ApiClientError(error.code ?? "request_failed", error.message, response.status);
  }
  throw new ApiClientError("request_failed", `HTTP ${response.status}`, response.status);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: {
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  const body = await parseBody(response);
  if (!response.ok) throwApiError(response, body);
  if (!body || typeof body !== "object" || !("ok" in body) || (body as { ok: boolean }).ok !== true) {
    throw new ApiClientError("invalid_response", t("common.invalidResponse"), response.status);
  }
  return (body as unknown as { data: T }).data;
}

async function requestRaw<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", ...init });
  const body = await parseBody(response);
  if (!response.ok) throwApiError(response, body);
  if (!body || typeof body !== "object" || !("ok" in body) || (body as { ok: boolean }).ok !== true) {
    throw new ApiClientError("invalid_response", t("common.invalidResponse"), response.status);
  }
  return (body as unknown as { data: T }).data;
}

export const api = {
  health(): Promise<Health> {
    return request<unknown>("/api/health").then((data) => healthSchema.parse(data));
  },

  site(): Promise<PublicConfig> {
    return request<unknown>("/api/site").then((data) => publicConfigSchema.parse(data));
  },

  nav(): Promise<NavItem[]> {
    return request("/api/nav");
  },

  async me(): Promise<Me | null> {
    const response = await fetch("/api/me", {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    if (response.status === 401) return null;
    const body = await parseBody(response);
    if (!response.ok) throwApiError(response, body);
    if (!body || typeof body !== "object" || !("ok" in body) || (body as { ok: boolean }).ok !== true) {
      throw new ApiClientError("invalid_response", t("common.invalidResponse"), response.status);
    }
    return meSchema.parse((body as unknown as { data: unknown }).data);
  },

  async meOptional(): Promise<Me | null> {
    const response = await fetch("/api/me/optional", {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    const body = await parseBody(response);
    if (!response.ok) throwApiError(response, body);
    if (!body || typeof body !== "object" || !("ok" in body) || (body as { ok: boolean }).ok !== true) {
      throw new ApiClientError("invalid_response", t("common.invalidResponse"), response.status);
    }
    const data = (body as unknown as { data: { user: unknown } }).data;
    return data.user ? meSchema.parse(data) : null;
  },

  meSummary(): Promise<{ topicCount: number; replyCount: number; likeCount: number; bookmarkCount: number; unreadCount: number }> {
    return request("/api/me/summary");
  },

  async signIn(email: string, password: string): Promise<void> {
    const response = await fetch("/api/auth/sign-in/email", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await parseBody(response);
    if (!response.ok) throwApiError(response, body);
  },

  async signUp(input: {
    email: string;
    password: string;
    name: string;
    username: string;
    turnstileToken: string;
  }): Promise<void> {
    const response = await fetch("/api/auth/sign-up/email", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "x-turnstile-token": input.turnstileToken,
      },
      body: JSON.stringify({
        email: input.email,
        password: input.password,
        name: input.name,
        username: input.username,
      }),
    });
    const body = await parseBody(response);
    if (!response.ok) throwApiError(response, body);
  },

  async signOut(): Promise<void> {
    const response = await fetch("/api/auth/sign-out", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: "{}",
    });
    if (!response.ok) {
      const body = await parseBody(response);
      throwApiError(response, body);
    }
  },

  async requestPasswordReset(email: string): Promise<void> {
    const response = await fetch("/api/auth/request-password-reset", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ email, redirectTo: "/reset-password" }),
    });
    const body = await parseBody(response);
    if (!response.ok) throwApiError(response, body);
  },

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const response = await fetch("/api/auth/reset-password", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ token, newPassword }),
    });
    const body = await parseBody(response);
    if (!response.ok) throwApiError(response, body);
  },

  async verifyEmail(token: string): Promise<void> {
    const response = await fetch(`/api/auth/verify-email?token=${encodeURIComponent(token)}`, {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    const body = await parseBody(response);
    if (!response.ok) throwApiError(response, body);
  },

  async resendVerification(): Promise<void> {
    const response = await fetch("/api/auth/send-verification-email", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ callbackURL: "/me" }),
    });
    const body = await parseBody(response);
    if (!response.ok) throwApiError(response, body);
  },


  categories(): Promise<Category[]> {
    return request("/api/categories");
  },

  category(slug: string): Promise<Category> {
    return request(`/api/categories/${encodeURIComponent(slug)}`);
  },

  tags(): Promise<Tag[]> {
    return request("/api/tags");
  },

  tag(slug: string): Promise<TagDetail> {
    return request(`/api/tags/${encodeURIComponent(slug)}`);
  },

  siteStats(): Promise<SiteStats> {
    return request("/api/site/stats");
  },

  topics(params: { category?: string; tag?: string; sort?: TopicSort; page?: number; perPage?: number; digest?: boolean } = {}): Promise<TopicList> {
    const query = new URLSearchParams();
    if (params.category) query.set("category", params.category);
    if (params.tag) query.set("tag", params.tag);
    if (params.sort) query.set("sort", params.sort);
    if (params.page) query.set("page", String(params.page));
    if (params.perPage) query.set("perPage", String(params.perPage));
    if (params.digest) query.set("digest", "1");
    return request(`/api/topics?${query.toString()}`);
  },

  topic(id: string): Promise<TopicDetail> {
    return request(`/api/topics/${encodeURIComponent(id)}`);
  },

  posts(topicId: string, params: { page?: number; perPage?: number; onlyOp?: boolean; after?: number } = {}): Promise<PostPage> {
    const query = new URLSearchParams();
    if (params.page !== undefined) query.set("page", String(params.page));
    if (params.after !== undefined) query.set("after", String(params.after));
    if (params.perPage) query.set("perPage", String(params.perPage));
    if (params.onlyOp) query.set("onlyOp", "1");
    return request(`/api/topics/${encodeURIComponent(topicId)}/posts?${query.toString()}`);
  },

  createTopic(input: CreateTopicInput, turnstileToken: string): Promise<{ id: string; postId: string; pending?: boolean }> {
    return request("/api/topics", {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "x-turnstile-token": turnstileToken },
    });
  },

  createReply(topicId: string, input: CreatePostInput, turnstileToken: string): Promise<{ id: string; floor: number; pending?: boolean }> {
    return request(`/api/topics/${encodeURIComponent(topicId)}/posts`, {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "x-turnstile-token": turnstileToken },
    });
  },

  deleteTopic(id: string): Promise<{ deleted: boolean }> {
    return request(`/api/topics/${encodeURIComponent(id)}`, { method: "DELETE" });
  },

  deletePost(id: string): Promise<{ deleted: boolean }> {
    return request(`/api/posts/${encodeURIComponent(id)}`, { method: "DELETE" });
  },

  likePost(id: string): Promise<{ liked: boolean; likeCount: number }> {
    return request(`/api/posts/${encodeURIComponent(id)}/like`, { method: "POST" });
  },

  bookmarkTopic(id: string): Promise<{ bookmarked: boolean }> {
    return request(`/api/topics/${encodeURIComponent(id)}/bookmark`, { method: "POST" });
  },

  viewTopic(id: string): Promise<{ viewed: boolean }> {
    return request(`/api/topics/${encodeURIComponent(id)}/view`, { method: "POST" });
  },

  user(username: string): Promise<{ id: string; username: string; name: string; bio: string | null; avatarKey: string | null; role: string; createdAt: number; topicCount: number; replyCount: number; likeCount: number; bookmarkCount: number }> {
    return request(`/api/users/${encodeURIComponent(username)}`);
  },

  userTopics(username: string, page = 1): Promise<TopicList> {
    return request(`/api/users/${encodeURIComponent(username)}/topics?page=${page}`);
  },

  userReplies(username: string, page = 1): Promise<{ items: Array<Record<string, unknown>>; page: number; perPage: number; total: number; totalPages: number }> {
    return request(`/api/users/${encodeURIComponent(username)}/replies?page=${page}`);
  },

  myTopics(page = 1): Promise<TopicList> {
    return request(`/api/me/topics?page=${page}`);
  },

  myReplies(page = 1): Promise<{ items: Array<Record<string, unknown>>; page: number; perPage: number; total: number; totalPages: number }> {
    return request(`/api/me/replies?page=${page}`);
  },

  myBookmarks(page = 1): Promise<TopicList> {
    return request(`/api/me/bookmarks?page=${page}`);
  },


  editTopic(id: string, input: EditPostInput, turnstileToken: string): Promise<{ version: number }> {
    return request(`/api/topics/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
      headers: { "x-turnstile-token": turnstileToken },
    });
  },

  editPost(id: string, input: EditPostInput, turnstileToken: string): Promise<{ version: number }> {
    return request(`/api/posts/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
      headers: { "x-turnstile-token": turnstileToken },
    });
  },

  revisions(topicId: string, postId?: string): Promise<Revision[]> {
    const query = postId ? `?postId=${encodeURIComponent(postId)}` : "";
    return request(`/api/topics/${encodeURIComponent(topicId)}/revisions${query}`);
  },

  pinTopic(id: string, pinLevel: 0 | 1 | 2, pinOrder?: number): Promise<{ pinLevel: number; pinOrder: number }> {
    return request(`/api/mod/topics/${encodeURIComponent(id)}/pin`, {
      method: "POST",
      body: JSON.stringify({ pinLevel, pinOrder }),
    });
  },

  lockTopic(id: string, locked: boolean): Promise<{ locked: boolean }> {
    return request(`/api/mod/topics/${encodeURIComponent(id)}/lock`, {
      method: "POST",
      body: JSON.stringify({ locked }),
    });
  },

  moveTopic(id: string, categoryId: string): Promise<{ category: { id: string; slug: string; name: string } }> {
    return request(`/api/mod/topics/${encodeURIComponent(id)}/move`, {
      method: "POST",
      body: JSON.stringify({ categoryId }),
    });
  },

  auditLogs(limit = 50): Promise<Array<Record<string, unknown>>> {
    return request(`/api/mod/audit?limit=${limit}`);
  },

  restorePost(id: string): Promise<{ restored: boolean }> {
    return request(`/api/mod/posts/${encodeURIComponent(id)}/restore`, { method: "POST" });
  },


  notifications(params: { page?: number; perPage?: number; unread?: boolean } = {}): Promise<{
    items: Array<{ id: string; type: string; title: string; snippet: string; topicId: string; postId: string | null; postFloor: number | null; readAt: number | null; createdAt: number; actor: { id: string; name: string; username: string | null } | null }>;
    unread: number; total: number; page: number; perPage: number; totalPages: number;
  }> {
    const query = new URLSearchParams();
    if (params.page) query.set("page", String(params.page));
    if (params.perPage) query.set("perPage", String(params.perPage));
    if (params.unread) query.set("unread", "1");
    return request(`/api/me/notifications?${query.toString()}`);
  },

  markNotificationsRead(input: { ids?: string[]; all?: boolean }): Promise<{ read: boolean }> {
    return request("/api/me/notifications/read", { method: "POST", body: JSON.stringify(input) });
  },

  preferences(): Promise<{ email: Record<string, boolean>; categories: string[] }> {
    return request("/api/me/preferences");
  },

  updatePreferences(email: Record<string, boolean>): Promise<{ email: Record<string, boolean> }> {
    return request("/api/me/preferences", { method: "PATCH", body: JSON.stringify({ email }) });
  },

  unsubscribePreview(token: string): Promise<{ email: string; category: string; valid: boolean }> {
    return request(`/api/unsubscribe/preview?token=${encodeURIComponent(token)}`);
  },

  unsubscribe(token: string): Promise<{ unsubscribed: boolean; category: string }> {
    return request("/api/unsubscribe", { method: "POST", body: JSON.stringify({ token }) });
  },

  adminEmails(limit = 50): Promise<Array<Record<string, unknown>>> {
    return request(`/api/admin/emails?limit=${limit}`);
  },

  runDigest(): Promise<{ users: number; sent: number; skipped: number; failed: number; remaining: number }> {
    return request("/api/admin/emails/digest", { method: "POST" });
  },

  adminOverview(): Promise<AdminOverview> {
    return request("/api/admin/overview");
  },

  setDigest(topicId: string, isDigest: boolean): Promise<{ isDigest: boolean }> {
    return request(`/api/mod/topics/${encodeURIComponent(topicId)}/digest`, {
      method: "POST",
      body: JSON.stringify({ isDigest }),
    });
  },

  runDailyMaintenance(): Promise<Record<string, unknown>> {
    return request("/api/admin/maintenance/daily", { method: "POST" });
  },

  runAccountCleanup(): Promise<{ anonymized: number }> {
    return request("/api/admin/maintenance/cleanup", { method: "POST" });
  },


  search(q: string, page = 1, sort: SearchSort = "relevance"): Promise<SearchResponse> {
    const query = new URLSearchParams({ q, page: String(page), sort });
    return request(`/api/search?${query.toString()}`);
  },

  report(input: { targetType: "topic" | "post"; targetId: string; reasonCode: string; detail?: string }): Promise<{ reported: boolean }> {
    return request("/api/reports", { method: "POST", body: JSON.stringify(input) });
  },

  modReports(status = "pending", page = 1): Promise<{
    items: Array<Record<string, unknown>>;
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
  }> {
    return request(`/api/mod/reports?status=${encodeURIComponent(status)}&page=${page}`);
  },

  resolveReport(id: string, input: { status: "resolved" | "dismissed"; resolutionNote?: string }): Promise<{ status: string }> {
    return request(`/api/mod/reports/${encodeURIComponent(id)}/resolve`, { method: "POST", body: JSON.stringify(input) });
  },

  reindexSearch(): Promise<{ posts: number; batches: number }> {
    return request("/api/admin/search/reindex", { method: "POST" });
  },

  async exportAccount(): Promise<Blob> {
    const response = await fetch("/api/me/export", { method: "POST", credentials: "same-origin" });
    if (!response.ok) {
      const body = await parseBody(response);
      throwApiError(response, body);
    }
    return await response.blob();
  },

  changePassword(currentPassword: string, newPassword: string): Promise<{ status: boolean }> {
    return request("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword, revokeOtherSessions: true }),
    });
  },

  deleteAccount(password: string): Promise<{ deleting: boolean; finalizeAt: number }> {
    return request("/api/me/delete", { method: "POST", body: JSON.stringify({ password }) });
  },

  cancelAccountDeletion(): Promise<{ deleting: boolean; cancelled: boolean }> {
    return request("/api/me/delete/cancel", { method: "POST" });
  },

  async adminSettings(): Promise<{ config: AppConfig; version: string; errors: { group: string; message: string }[] }> {
    return request("/api/admin/settings");
  },

  async updateAdminSettings(patch: DeepPartial<AppConfig>, version: string): Promise<{ config: AppConfig; version: string }> {
    return request("/api/admin/settings", { method: "PATCH", body: JSON.stringify({ patch, version }) });
  },

  pendingReviews(): Promise<{ items: PendingReviewItem[] }> {
    return request("/api/mod/pending");
  },

  decideReview(kind: "topic" | "post", id: string, input: ReviewDecisionInput): Promise<{ id: string; status: string }> {
    return request(`/api/mod/${kind === "topic" ? "topics" : "posts"}/${encodeURIComponent(id)}/review`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  signUpload(input: UploadSignInput): Promise<{
    key: string;
    uploadUrl: string;
    expiresIn: number;
    contentType: string;
    maxBytes: number;
  }> {
    return request("/api/uploads/sign", { method: "POST", body: JSON.stringify(input) });
  },

  completeUpload(input: UploadCompleteInput): Promise<UploadResult> {
    return request("/api/uploads/complete", { method: "POST", body: JSON.stringify(input) });
  },

  directUpload(file: File, kind: UploadKind, contentType: string): Promise<UploadResult> {
    return requestRaw<UploadResult>("/api/uploads/direct", {
      method: "POST",
      body: file,
      headers: {
        accept: "application/json",
        "content-type": contentType,
        "x-upload-kind": kind,
        "x-file-name": encodeURIComponent(file.name),
      },
    });
  },

  adminCategories(): Promise<AdminCategory[]> {
    return request("/api/admin/categories");
  },

  createAdminCategory(input: CategoryInput): Promise<AdminCategory> {
    return request("/api/admin/categories", { method: "POST", body: JSON.stringify(input) });
  },

  updateAdminCategory(id: string, input: CategoryInput): Promise<AdminCategory> {
    return request(`/api/admin/categories/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) });
  },

  deleteAdminCategory(id: string): Promise<{ deleted: boolean }> {
    return request(`/api/admin/categories/${encodeURIComponent(id)}`, { method: "DELETE" });
  },

  reorderAdminCategories(ids: string[]): Promise<AdminCategory[]> {
    return request("/api/admin/categories/reorder", { method: "PATCH", body: JSON.stringify({ ids }) });
  },

  addCategoryModerator(categoryId: string, username: string): Promise<AdminCategory[]> {
    return request(`/api/admin/categories/${encodeURIComponent(categoryId)}/moderators`, {
      method: "POST",
      body: JSON.stringify({ username }),
    });
  },

  removeCategoryModerator(categoryId: string, userId: string): Promise<AdminCategory[]> {
    return request(`/api/admin/categories/${encodeURIComponent(categoryId)}/moderators/${encodeURIComponent(userId)}`, {
      method: "DELETE",
    });
  },

  adminUsers(params: { q?: string; status?: string; role?: string; page?: number } = {}): Promise<{
    items: Array<Record<string, unknown>>;
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
  }> {
    const query = new URLSearchParams();
    if (params.q) query.set("q", params.q);
    if (params.status && params.status !== "all") query.set("status", params.status);
    if (params.role && params.role !== "all") query.set("role", params.role);
    if (params.page && params.page > 1) query.set("page", String(params.page));
    const suffix = query.toString();
    return request(`/api/admin/users${suffix ? `?${suffix}` : ""}`);
  },

  updateAdminUserRole(id: string, role: "user" | "moderator" | "admin"): Promise<{ role: string }> {
    return request(`/api/admin/users/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ role }) });
  },

  suspendAdminUser(id: string, reason = ""): Promise<{ status: string }> {
    return request(`/api/admin/users/${encodeURIComponent(id)}/suspend`, { method: "POST", body: JSON.stringify({ reason }) });
  },

  unsuspendAdminUser(id: string): Promise<{ status: string }> {
    return request(`/api/admin/users/${encodeURIComponent(id)}/unsuspend`, { method: "POST" });
  },

  adminTags(): Promise<AdminTag[]> {
    return request("/api/admin/tags");
  },

  createAdminTag(input: TagInput): Promise<AdminTag> {
    return request("/api/admin/tags", { method: "POST", body: JSON.stringify(input) });
  },

  updateAdminTag(id: string, input: TagInput): Promise<AdminTag> {
    return request(`/api/admin/tags/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) });
  },

  deleteAdminTag(id: string): Promise<{ deleted: boolean }> {
    return request(`/api/admin/tags/${encodeURIComponent(id)}`, { method: "DELETE" });
  },

  adminNav(): Promise<NavItem[]> {
    return request("/api/admin/nav");
  },

  createAdminNav(input: NavItemInput): Promise<NavItem> {
    return request("/api/admin/nav", { method: "POST", body: JSON.stringify(input) });
  },

  updateAdminNav(id: string, input: NavItemInput): Promise<NavItem> {
    return request(`/api/admin/nav/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) });
  },

  deleteAdminNav(id: string): Promise<{ deleted: boolean }> {
    return request(`/api/admin/nav/${encodeURIComponent(id)}`, { method: "DELETE" });
  },

  reorderAdminNav(ids: string[]): Promise<NavItem[]> {
    return request("/api/admin/nav/reorder", { method: "PATCH", body: JSON.stringify({ ids }) });
  },

  adminIntegrations(): Promise<AdminIntegrations> {
    return request("/api/admin/integrations");
  },

  updateAdminIntegrations(patch: {
    integration?: {
      cloudflare?: Partial<AdminIntegrations["effective"]["cloudflare"]>;
    };
    secrets?: Partial<Record<string, string | null>>;
  }, version: string): Promise<AdminIntegrations> {
    return request("/api/admin/integrations", {
      method: "PATCH",
      body: JSON.stringify({ ...patch, version: Number(version) }),
    });
  },

  testIntegration(service: "resend" | "turnstile" | "cloudflare"): Promise<{ service: string; ok: boolean; message: string; status?: number; detail?: string }> {
    return request("/api/admin/integrations/test", { method: "POST", body: JSON.stringify({ service }) });
  },
};
