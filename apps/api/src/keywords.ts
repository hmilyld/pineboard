import { createSensitiveMatcher, type SensitiveMatcher, type SensitiveMatchResult } from "@pineboard/shared";

/**
 * One matcher per word-list fingerprint. Isolates are long-lived, so building
 * the trie once and reusing it keeps the per-request cost negligible (the
 * default list builds in under 1ms) while still picking up admin edits.
 */
let cached: { key: string; matcher: SensitiveMatcher } | null = null;

function matcherFor(words: readonly string[]): SensitiveMatcher {
  const key = words.join("\u0000");
  if (cached?.key === key) return cached.matcher;
  const matcher = createSensitiveMatcher(words);
  cached = { key, matcher };
  return matcher;
}

export type KeywordVerdict =
  | { flagged: false }
  | { flagged: true; words: string[]; hits: SensitiveMatchResult["hits"] };

/**
 * Screen user content before it is written. Returns the matched words so the
 * caller can store them on the pending item for the moderator.
 */
export function screenContent(
  security: { sensitiveWordsEnabled: boolean; sensitiveWords: readonly string[] },
  ...parts: Array<string | null | undefined>
): KeywordVerdict {
  if (!security.sensitiveWordsEnabled || security.sensitiveWords.length === 0) {
    return { flagged: false };
  }
  const text = parts.filter((part): part is string => Boolean(part)).join("\n");
  if (!text) return { flagged: false };
  const result = matcherFor(security.sensitiveWords).match(text, 10);
  if (result.hits.length === 0) return { flagged: false };
  return { flagged: true, words: result.words, hits: result.hits };
}
