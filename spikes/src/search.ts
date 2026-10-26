const ZERO_WIDTH = /[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g;
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/** Strip fenced/inline code and Markdown syntax while keeping link text. */
export function stripMarkdown(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[*_~>#]+/g, " ");
}

export function normalizeText(input: string): string {
  return stripMarkdown(input)
    .normalize("NFKC")
    .replace(ZERO_WIDTH, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * CJK bigrams + whole ASCII words. `游戏攻略` -> `游戏 戏攻 攻略`;
 * `Elden Ring 攻略` -> `elden ring 攻 攻略` (single CJK runs stay as one token).
 */
export function bigramTokens(input: string): string {
  const normalized = normalizeText(input);
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
  // Do not dedupe: repeated terms are needed to keep phrase adjacency.
  return tokens.join(" ");
}

/** FTS5 fallback: one CJK character cannot form a bigram. */
export function needsLikeFallback(input: string): boolean {
  const normalized = normalizeText(input);
  return normalized.length === 1 && CJK.test(normalized);
}

export function likePattern(input: string): string {
  const escaped = input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  return `%${escaped}%`;
}
