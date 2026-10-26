import { describe, expect, it } from "vitest";
import { createPostSchema, createTopicSchema, excerpt, markdownToPlainText, slugSchema } from "./content";

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
