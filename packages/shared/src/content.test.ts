import { describe, expect, it } from "vitest";
import {
  bigramTokens,
  createPostSchema,
  createTopicSchema,
  excerpt,
  ftsPhrase,
  likePattern,
  markdownToPlainText,
  needsLikeFallback,
  normalizeForSearch,
  slugSchema,
} from "./content";

describe("content contracts", () => {
  it("validates a topic payload", () => {
    const result = createTopicSchema.safeParse({
      categoryId: "cat-general",
      title: "标题",
      contentMd: "正文",
      tagIds: ["tag-guide"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects too many tags and empty titles", () => {
    expect(createTopicSchema.safeParse({ categoryId: "c", title: "", contentMd: "x", tagIds: [] }).success).toBe(false);
    expect(
      createTopicSchema.safeParse({
        categoryId: "c",
        title: "t",
        contentMd: "x",
        tagIds: ["1", "2", "3", "4", "5", "6"],
      }).success,
    ).toBe(false);
  });

  it("validates replies and slugs", () => {
    expect(createPostSchema.safeParse({ contentMd: "hi" }).success).toBe(true);
    expect(createPostSchema.safeParse({ contentMd: "" }).success).toBe(false);
    expect(slugSchema.safeParse("game-guide").success).toBe(true);
    expect(slugSchema.safeParse("Game Guide").success).toBe(false);
  });

  it("strips markdown for plain-text snippets", () => {
    const text = markdownToPlainText("# 标题\n\n**粗体** [链接](https://x.test)\n\n```js\ncode\n```");
    expect(text).toBe("标题 粗体 链接");
    expect(excerpt("a".repeat(200), 10)).toBe("aaaaaaaaaa…");
  });
});

describe("search helpers", () => {
  it("normalizes width, case and punctuation", () => {
    expect(normalizeForSearch("  Ｈｅｌｌｏ，世界!! ")).toBe("hello 世界");
  });

  it("emits CJK bigrams and keeps ASCII words whole", () => {
    expect(bigramTokens("中文 hello")).toBe("中文 hello");
    expect(bigramTokens("中文网")).toBe("中文 文网");
    expect(bigramTokens("")).toBe("");
  });

  it("only falls back to LIKE for a single CJK character", () => {
    expect(needsLikeFallback("中")).toBe(true);
    expect(needsLikeFallback("中文")).toBe(false);
    expect(needsLikeFallback("a")).toBe(false);
  });

  it("escapes LIKE and FTS metacharacters", () => {
    expect(likePattern("50%_off")).toBe("%50\\%\\_off%");
    expect(ftsPhrase('say "hi"')).toBe('"say ""hi"""');
  });
});
