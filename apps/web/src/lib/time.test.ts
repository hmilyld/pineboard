import { describe, expect, it } from "vitest";
import { defaultTimeZone, formatDate, formatDateOnly, formatRelative, setSiteTimeZone } from "./time";

describe("time helpers", () => {
  it("falls back to Asia/Shanghai when the site has no zone", () => {
    setSiteTimeZone("UTC");
    expect(defaultTimeZone()).toBe("UTC");
    setSiteTimeZone(null);
    expect(defaultTimeZone()).toBe("Asia/Shanghai");
  });

  it("formats a fixed timestamp in the requested zone", () => {
    expect(formatDateOnly(0, "UTC")).toContain("1970");
    expect(formatDate(0, "UTC")).toContain("1970");
  });

  it("always returns text for relative times", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(formatRelative(now)).not.toBe("");
    expect(formatRelative(now - 90 * 24 * 3600)).not.toBe("");
  });
});
