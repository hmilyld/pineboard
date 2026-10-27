import type { ErrorCode } from "@pineboard/shared";

/**
 * Server responses carry a stable `error.code`; the UI renders the localized
 * copy for it and only falls back to the server `message` for unknown codes.
 * Error copy lives here rather than in the dictionaries because it is keyed by
 * the API contract instead of by page.
 */
const MESSAGES: Record<ErrorCode, { "zh-CN": string; en: string }> = {
  auth_required: { "zh-CN": "请先登录", en: "Please sign in first" },
  email_unverified: { "zh-CN": "请先验证邮箱", en: "Please verify your email first" },
  forbidden: { "zh-CN": "没有权限执行此操作", en: "You do not have permission to do that" },
  not_found: { "zh-CN": "内容不存在或已被删除", en: "Not found, or already deleted" },
  gone: { "zh-CN": "内容已被删除", en: "This content was deleted" },
  validation_error: { "zh-CN": "提交的内容不合法，请检查", en: "Some of the submitted values are invalid" },
  version_conflict: { "zh-CN": "内容已被修改，请刷新后重试", en: "This was changed elsewhere. Refresh and try again." },
  edit_window_expired: { "zh-CN": "编辑窗口已过", en: "The edit window has closed" },
  edit_locked: { "zh-CN": "该内容不能再编辑", en: "This content can no longer be edited" },
  captcha_failed: { "zh-CN": "人机验证失败，请重试", en: "Verification failed. Please try again." },
  captcha_unavailable: { "zh-CN": "人机验证暂时不可用，请稍后重试", en: "Verification is unavailable. Please try again later." },
  rate_limited: { "zh-CN": "操作过于频繁，请稍后再试", en: "Too many requests. Please slow down." },
  conflict: { "zh-CN": "状态已变化，请刷新后重试", en: "The state changed elsewhere. Refresh and try again." },
  maintenance: { "zh-CN": "站点维护中，请稍后再试", en: "The site is under maintenance. Please try again later." },
  internal_error: { "zh-CN": "服务器内部错误，请稍后重试", en: "Server error. Please try again later." },
};

export function errorMessage(code: string | null | undefined, locale: string, fallback: string): string {
  if (!code) return fallback;
  const entry = MESSAGES[code as ErrorCode];
  if (!entry) return fallback;
  return locale === "en" ? entry.en : entry["zh-CN"];
}
