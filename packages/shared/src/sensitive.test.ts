import { describe, expect, it } from "vitest";
import {
  containsSensitive,
  createSensitiveMatcher,
  DEFAULT_SENSITIVE_WORDS,
  isIgnorable,
} from "./sensitive";

describe("createSensitiveMatcher", () => {
  it("matches a plain word and reports its span", () => {
    const matcher = createSensitiveMatcher(["代开发票"]);
    const result = matcher.match("我能代开发票，需要吗");
    expect(result.words).toEqual(["代开发票"]);
    expect(result.hits[0]).toMatchObject({ start: 2, end: 7 });
  });

  it("returns nothing when the dictionary is empty", () => {
    const matcher = createSensitiveMatcher([]);
    expect(matcher.size).toBe(0);
    expect(matcher.match("代开发票").words).toEqual([]);
  });

  it("drops blank, duplicate and over-long entries", () => {
    const matcher = createSensitiveMatcher(["代开发票", "  代开发票  ", "", "   ", "x".repeat(64)]);
    expect(matcher.size).toBe(1);
  });

  it("ignores case for latin words", () => {
    const matcher = createSensitiveMatcher(["Viagra"]);
    expect(matcher.match("buy VIAGRA cheap").words).toEqual(["viagra"]);
  });
});

describe("filler-character evasion", () => {
  const matcher = createSensitiveMatcher(["代开发票", "fuck"]);

  it("matches across whitespace", () => {
    expect(matcher.match("代 开 发 票").words).toEqual(["代开发票"]);
  });

  it("matches across punctuation", () => {
    expect(matcher.match("代*开*发*票").words).toEqual(["代开发票"]);
    expect(matcher.match("f.u.c.k").words).toEqual(["fuck"]);
  });

  it("matches across fullwidth separators", () => {
    expect(matcher.match("代　开　发　票").words).toEqual(["代开发票"]);
    expect(matcher.match("代，开，发，票").words).toEqual(["代开发票"]);
  });

  it("does not match when filler is implausibly long", () => {
    expect(matcher.match("代 是 一 个 很 长 的 句 子 开 发 票").words).toEqual([]);
  });

  it("does not match out-of-order characters", () => {
    expect(matcher.match("票发开代").words).toEqual([]);
  });
});

describe("false-positive guard", () => {
  const matcher = createSensitiveMatcher(DEFAULT_SENSITIVE_WORDS);

  it("keeps ordinary technical and civic discussion clean", () => {
    const benign = [
      "今天天气不错，我们一起去公园散步吧",
      "这个功能怎么使用？有人能帮忙解答一下吗",
      "我喜欢学习编程，尤其是 TypeScript",
      "请问这个数据结构的复杂度是多少",
      "政府发布新的政策法规",
      "我想买一台新的笔记本电脑",
      "这个问题的解决方案很优雅",
      "客户服务很好，客服响应及时",
    ];
    for (const text of benign) {
      expect(matcher.match(text).words, text).toEqual([]);
    }
  });

  it("still catches the words it claims to ship", () => {
    expect(matcher.match("办假证快速上岗").words).toEqual(["办假证"]);
    expect(matcher.match("网络赌博平台").words).toEqual(["网络赌博"]);
    expect(matcher.match("你试试 viagra").words).toEqual(["viagra"]);
  });

  it("never ships single-character or 2-char generic entries", () => {
    for (const word of DEFAULT_SENSITIVE_WORDS) {
      expect(word.length, word).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("matching limits", () => {
  it("respects the hit limit", () => {
    const matcher = createSensitiveMatcher(["博彩", "洗钱", "代考"]);
    const result = matcher.match("博彩 洗钱 代考", 2);
    expect(result.hits.length).toBe(2);
  });

  it("prefers the longest word at the same start", () => {
    const matcher = createSensitiveMatcher(["代开", "代开发票"]);
    expect(matcher.match("代开发票").words).toEqual(["代开发票"]);
  });

  it("containsSensitive is a boolean shortcut", () => {
    const matcher = createSensitiveMatcher(["博彩"]);
    expect(containsSensitive(matcher, "这里有博彩广告")).toBe(true);
    expect(containsSensitive(matcher, "这里很干净")).toBe(false);
  });

  it("treats every separator in the ignore set as ignorable", () => {
    for (const char of [" ", "\t", "\u3000", "*", "，", "【", "\u200b"]) {
      expect(isIgnorable(char), JSON.stringify(char)).toBe(true);
    }
    expect(isIgnorable("代")).toBe(false);
  });
});
