import { describe, expect, it } from "vitest";
import { categoryInputSchema, navItemInputSchema, tagInputSchema } from "./admin";
import { DEFAULTS, configSchema } from "./config";

describe("admin contracts", () => {
  it("defaults category color and rejects non-hex colors", () => {
    const parsed = categoryInputSchema.parse({ slug: "tools", name: "工具" });
    expect(parsed.color).toBe("#14513f");
    expect(categoryInputSchema.safeParse({ slug: "tools", name: "工具", color: "red" }).success).toBe(false);
  });

  it("accepts internal and external nav links", () => {
    expect(navItemInputSchema.parse({ label: "标签", href: "/tags" }).kind).toBe("link");
    expect(navItemInputSchema.safeParse({ label: "外链", href: "https://example.com" }).success).toBe(true);
  });

  it("rejects empty, protocol-relative, and javascript nav links", () => {
    expect(navItemInputSchema.safeParse({ label: "空", href: "" }).success).toBe(false);
    expect(navItemInputSchema.safeParse({ label: "协议相对", href: "//evil.test" }).success).toBe(false);
    expect(navItemInputSchema.safeParse({ label: "脚本", href: "javascript:alert(1)" }).success).toBe(false);
  });

  it("allows the categories dropdown without an href", () => {
    expect(navItemInputSchema.parse({ label: "版块", kind: "categories" }).href).toBe("");
  });

  it("defaults tag color/status and validates status/color", () => {
    const parsed = tagInputSchema.parse({ slug: "guide", name: "攻略" });
    expect(parsed.color).toBe("#71717a");
    expect(parsed.status).toBe("active");
    expect(tagInputSchema.safeParse({ slug: "guide", name: "攻略", status: "deleted" }).success).toBe(false);
    expect(tagInputSchema.safeParse({ slug: "guide", name: "攻略", color: "gray" }).success).toBe(false);
  });

  it("adds an empty integration group to defaults", () => {
    expect(DEFAULTS.integration.cloudflare).toEqual({ accountId: "", r2Bucket: "", cdnUrl: "", turnstileSiteKey: "" });
    expect(configSchema.parse(DEFAULTS).integration.cloudflare.turnstileSiteKey).toBe("");
  });
});
