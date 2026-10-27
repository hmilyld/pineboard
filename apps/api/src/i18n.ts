import type { AppConfig, Locale } from "@pineboard/shared";

/**
 * Server-rendered copy that reaches crawlers and social cards before the SPA
 * boots. User content is never translated; only the fixed phrases around it.
 */
type Copy = Record<Locale, string>;

const COPY = {
  topicMissing: { "zh-CN": "主题不存在", en: "Topic not found" },
  topicMissingOrDeleted: { "zh-CN": "该主题不存在或已被删除", en: "This topic does not exist or was deleted" },
  topicDeleted: { "zh-CN": "主题已删除", en: "Topic deleted" },
  topicDeletedBody: { "zh-CN": "该主题已被删除", en: "This topic has been deleted" },
  topicMissingOrHidden: { "zh-CN": "该主题不存在或已被隐藏", en: "This topic does not exist or was hidden" },
  topicDiscussion: { "zh-CN": "关于「{title}」的讨论", en: "Discussion about “{title}”" },
  categoryMissing: { "zh-CN": "版块不存在", en: "Category not found" },
  categoryMissingBody: { "zh-CN": "该版块不存在", en: "This category does not exist" },
  categoryBrowse: { "zh-CN": "浏览 {name} 版块的主题", en: "Browse topics in {name}" },
  tagMissing: { "zh-CN": "标签不存在", en: "Tag not found" },
  tagMissingBody: { "zh-CN": "该标签不存在", en: "This tag does not exist" },
  tagTopics: { "zh-CN": "使用「{name}」标签的主题", en: "Topics tagged “{name}”" },
  userMissing: { "zh-CN": "用户不存在", en: "User not found" },
  userMissingBody: { "zh-CN": "该用户不存在", en: "This user does not exist" },
  userHome: { "zh-CN": "@{username} 的主页", en: "The profile of @{username}" },
} satisfies Record<string, Copy>;

function fill(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match);
}

/**
 * UI locale for server-rendered copy: the site language chosen in the admin
 * panel. One URL per page (no `/en/` prefix), so this is the only language a
 * crawler or social card can see.
 */
export function docLocale(config: AppConfig): Locale {
  return config.site.language === "en" ? "en" : "zh-CN";
}

export function copy(key: keyof typeof COPY, locale: Locale, params: Record<string, string> = {}): string {
  return fill(COPY[key][locale], params);
}
