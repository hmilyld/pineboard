import { t } from "@/i18n";

const CLASS_BY_SLUG: Record<string, string> = {
  tools: "c-tool",
  tool: "c-tool",
  general: "c-gen",
  gen: "c-gen",
  games: "c-game",
  game: "c-game",
  dev: "c-dev",
  chat: "c-chat",
};

export function categoryClass(slug: string | null | undefined): string {
  return (slug && CLASS_BY_SLUG[slug]) || "c-gen";
}

/**
 * Inline `--c-base` from the DB overrides the legacy slug palette. CSS maps it
 * to `--c` and lightens it in dark mode so admin colors stay readable.
 */
export function categoryStyle(color: string | null | undefined): Record<string, string> {
  return color ? { "--c-base": color } : {};
}

/** Short tab label, e.g. the "Latest reply" tab on a topic list. */
export function sortTabLabel(sort: string): string {
  if (sort === "new") return t("topicSort.new");
  if (sort === "hot") return t("topicSort.hot");
  if (sort === "digest") return t("topicSort.digest");
  return t("topicSort.latest");
}

/** Long form used where the column header needs a full phrase. */
export function sortLongLabel(sort: string): string {
  if (sort === "new") return t("topicSort.new-long");
  if (sort === "hot") return t("topicSort.hot-long");
  return t("topicSort.latest-long");
}
