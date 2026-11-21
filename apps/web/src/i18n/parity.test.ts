import { describe, expect, it } from "vitest";
import { en } from "./en";
import { zhCN } from "./zh-CN";

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") result[path] = value;
    else Object.assign(result, flatten(value, path));
  }
  return result;
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort();
}

describe("i18n dictionaries", () => {
  const english = flatten(en as unknown as Tree);
  const chinese = flatten(zhCN as unknown as Tree);

  it("ships the same keys in both languages", () => {
    expect(Object.keys(english).sort()).toEqual(Object.keys(chinese).sort());
  });

  it("keeps interpolation placeholders in sync", () => {
    const mismatched = Object.keys(english).filter(
      (key) => JSON.stringify(placeholders(english[key]!)) !== JSON.stringify(placeholders(chinese[key] ?? "")),
    );
    expect(mismatched).toEqual([]);
  });

  it("has no empty strings", () => {
    const empty = [...Object.entries(english), ...Object.entries(chinese)].filter(([, value]) => !value.trim());
    expect(empty).toEqual([]);
  });
});
