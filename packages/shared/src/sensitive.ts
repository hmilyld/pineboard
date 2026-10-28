/**
 * Sensitive-word matching for user-generated content.
 *
 * A compact trie matcher (not Aho-Corasick): the dictionary is small and
 * operator-curated, so building it costs microseconds and keeping it inline
 * avoids a 400KB dependency plus the ~200ms automaton build that would blow
 * the Workers free-plan CPU budget.
 *
 * Required fields are the *ordinal gaps* between the characters of a match, so
 * "发 票", "f*u*c*k" and "发\t票" are caught without a full Unicode
 * normaliser: only whitespace and punctuation are skipped, and the ratio of
 * skipped characters is capped so short words buried in long runs of filler do
 * not produce matches.
 */

export type SensitiveWordHit = {
  /** The dictionary word that matched, lowercased. */
  word: string;
  /** Character offset of the first character of the match in the input. */
  start: number;
  /** Character offset just past the last character of the match. */
  end: number;
};

export type SensitiveMatchResult = {
  hits: SensitiveWordHit[];
  /** Distinct matched words, for logging and admin review. */
  words: string[];
};

type TrieNode = {
  children: Map<string, TrieNode>;
  /** Set on a node that terminates a dictionary word. */
  word?: string;
};

/** Characters ignored when matching, so filler cannot split a word. */
const IGNORABLE = new Set([
  " ",
  "\t",
  "\n",
  "\r",
  "\u3000",
  "\u00a0",
  "\u200b",
  "\u200c",
  "\u200d",
  "\ufeff",
  ".",
  ",",
  "!",
  "?",
  ":",
  ";",
  "'",
  '"',
  "`",
  "~",
  "^",
  "*",
  "_",
  "+",
  "=",
  "|",
  "\\",
  "/",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  "<",
  ">",
  "「",
  "」",
  "『",
  "』",
  "《",
  "》",
  "【",
  "】",
  "，",
  "。",
  "！",
  "？",
  "：",
  "；",
  "、",
  "…",
  "—",
  "·",
  "•",
]);

/**
 * Longest run of skipped filler allowed inside one match. A word of n
 * characters may span at most n + 2 filler characters, so "发 票" matches but a
 * word buried in a sentence-sized gap does not.
 */
const MAX_FILLER_PER_MATCH = 2;

export function normalizeForMatch(char: string): string {
  return char.toLowerCase();
}

export function isIgnorable(char: string): boolean {
  return IGNORABLE.has(char);
}

export type SensitiveMatcher = {
  /** All dictionary words, for admin display. */
  readonly size: number;
  match(text: string, limit?: number): SensitiveMatchResult;
};

/**
 * Build a matcher from a word list. Empty entries, duplicates and words longer
 * than 32 characters are dropped; the operator's list is untrusted input.
 */
export function createSensitiveMatcher(words: readonly string[]): SensitiveMatcher {
  const root: TrieNode = { children: new Map() };
  const seen = new Set<string>();
  for (const raw of words) {
    const word = raw.trim();
    if (!word || word.length > 32) continue;
    let node = root;
    for (const char of word) {
      const key = normalizeForMatch(char);
      let next = node.children.get(key);
      if (!next) {
        next = { children: new Map() };
        node.children.set(key, next);
      }
      node = next;
    }
    if (node.word === undefined) {
      node.word = word.toLowerCase();
      seen.add(node.word);
    }
  }

  return {
    size: seen.size,
    match(text: string, limit = 20): SensitiveMatchResult {
      const hits: SensitiveWordHit[] = [];
      if (!text || seen.size === 0) return { hits, words: [] };

      const chars = [...text];
      const n = chars.length;
      for (let start = 0; start < n && hits.length < limit; start++) {
        const firstKey = normalizeForMatch(chars[start]!);
        let node = root.children.get(firstKey);
        if (!node) continue;
        let lastMatch: SensitiveWordHit | null = null;
        let filler = 0;
        for (let i = start + 1; i <= n; i++) {
          if (node.word !== undefined) {
            lastMatch = { word: node.word, start, end: i };
          }
          if (i === n) break;
          const char = chars[i]!;
          if (isIgnorable(char)) {
            filler++;
            // Keep scanning only while the gap stays plausible for this branch.
            if (filler > MAX_FILLER_PER_MATCH) break;
            continue;
          }
          const next = node.children.get(normalizeForMatch(char));
          if (!next) break;
          node = next;
          filler = 0;
        }
        if (lastMatch && !overlaps(hits, lastMatch)) hits.push(lastMatch);
      }

      const words = [...new Set(hits.map((hit) => hit.word))];
      return { hits, words };
    },
  };
}

function overlaps(hits: SensitiveWordHit[], candidate: SensitiveWordHit): boolean {
  return hits.some((hit) => candidate.start < hit.end && hit.start < candidate.end);
}

/** Convenience wrapper for callers that only need a boolean. */
export function containsSensitive(matcher: SensitiveMatcher, text: string): boolean {
  return matcher.match(text, 1).hits.length > 0;
}

/**
 * Default dictionary shipped with the product. It deliberately holds only
 * high-confidence terms (fraud, illegal dealings, sexual services, gambling) so
 * organic discussion is not diverted to review. Operators add their own words
 * in the admin UI.
 */
export const DEFAULT_SENSITIVE_WORDS: readonly string[] = [
  // Fraud / scam
  "招募刷单",
  "刷单返利",
  "刷信誉兼职",
  "代开发票",
  "出售发票",
  "办理证件",
  "办假证",
  "银行卡出租",
  "出售银行卡",
  "洗钱团伙",
  "跑分平台",
  "博彩代收",
  "网络兼职日结",
  "高回报投资群",
  "带你炒股",
  "荐股群",
  "虚拟币搬砖",
  // Gambling
  "网络赌博",
  "赌场开户",
  "六合彩",
  "时时彩",
  "百家乐",
  "老虎机平台",
  "棋牌代理",
  "博彩平台",
  // Sexual services / adult
  "上门服务",
  "楼凤网",
  "特殊服务包夜",
  "援交妹",
  "外围女",
  "约炮软件",
  "一夜情服务",
  // Drugs / contraband
  "冰毒交易",
  "摇头丸",
  "氯胺酮",
  "迷药出售",
  "销售枪支",
  "办枪证",
  "仿真枪出售",
  // Illegal services
  "黑客接单",
  "查开房记录",
  "开锁培训",
  "代考包过",
  "替考服务",
  "论文代写代发",
  "代办信用卡",
  "信用卡套现",
  // English
  "viagra",
  "casino",
  "porn",
  "escort service",
  "buy fake id",
];
