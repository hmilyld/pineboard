import type { AppConfig } from "@pineboard/shared";
import type { SessionUser } from "./env";

export type PermissionDecision =
  | { allowed: true }
  | { allowed: false; code: "forbidden" | "edit_window_expired" | "edit_locked"; message: string };

export async function isCategoryModerator(
  db: D1Database,
  user: Pick<SessionUser, "id" | "role">,
  categoryId: string,
): Promise<boolean> {
  if (user.role === "admin") return true;
  if (user.role !== "moderator") return false;
  const row = await db
    .prepare("SELECT 1 AS ok FROM category_moderators WHERE category_id = ? AND user_id = ?")
    .bind(categoryId, user.id)
    .first<{ ok: number }>();
  return row?.ok === 1;
}

function windowExpired(createdAt: Date, minutes: number): boolean {
  if (minutes === 0) return false;
  return Date.now() - createdAt.getTime() > minutes * 60_000;
}

export async function canEditContent(input: {
  db: D1Database;
  user: SessionUser;
  config: AppConfig;
  categoryId: string;
  post: { authorId: string; createdAt: Date; status: string };
  topic: { replyCount: number; status: string };
  isFirst: boolean;
}): Promise<PermissionDecision> {
  const { user, config } = input;
  if (user.role === "admin") return { allowed: true };
  if (input.post.status !== "published" || input.topic.status !== "published") {
    return { allowed: false, code: "forbidden", message: "当前状态不可编辑" };
  }

  const staff = await isCategoryModerator(input.db, user, input.categoryId);
  if (staff) {
    if (input.post.authorId === user.id || config.edit.allowStaffEditOthers) {
      return { allowed: true };
    }
    return { allowed: false, code: "forbidden", message: "无权编辑该内容" };
  }

  if (input.post.authorId !== user.id) {
    return { allowed: false, code: "forbidden", message: "无权编辑该内容" };
  }
  if (config.edit.lockAfterReply && input.isFirst && input.topic.replyCount > 0) {
    return { allowed: false, code: "edit_locked", message: "主题已有回复，不能再编辑" };
  }
  const minutes =
    user.role === "moderator" ? config.edit.windowModeratorMinutes : config.edit.windowUserMinutes;
  if (windowExpired(input.post.createdAt, minutes)) {
    return { allowed: false, code: "edit_window_expired", message: "编辑窗口已过" };
  }
  return { allowed: true };
}

export async function canDeleteContent(input: {
  db: D1Database;
  user: SessionUser;
  config: AppConfig;
  categoryId: string;
  authorId: string;
}): Promise<boolean> {
  if (input.user.role === "admin") return true;
  if (await isCategoryModerator(input.db, input.user, input.categoryId)) return true;
  return input.authorId === input.user.id && input.config.edit.allowSelfDelete;
}

export async function canViewHistory(input: {
  db: D1Database;
  user: SessionUser | null;
  config: AppConfig;
  categoryId: string;
  authorId: string;
}): Promise<boolean> {
  const visibility = input.config.edit.historyVisibility;
  if (visibility === "public") return true;
  if (!input.user) return false;
  if (input.user.role === "admin") return true;
  if (await isCategoryModerator(input.db, input.user, input.categoryId)) return true;
  return input.user.id === input.authorId && visibility === "author";
}

export function canModerateTopic(user: SessionUser | null, moderator: boolean): boolean {
  return Boolean(user && (user.role === "admin" || moderator));
}
