import { describe, expect, it } from "vitest";
import { adminOverviewSchema, postPageSchema, searchSortSchema, siteConfigSchema, tagDetailSchema } from "@pineboard/shared";
import { startOfDaySeconds } from "./stats";

describe("v2 site stats boundaries", () => {
  it("computes Shanghai day start in UTC seconds", () => {
    const at = Date.UTC(2026, 9, 23, 10, 0, 0);
    expect(startOfDaySeconds("Asia/Shanghai", at)).toBe(Date.UTC(2026, 9, 22, 16, 0, 0) / 1000);
  });

  it("computes a DST-observing day start", () => {
    const at = Date.UTC(2026, 9, 23, 12, 0, 0);
    expect(startOfDaySeconds("America/New_York", at)).toBe(Date.UTC(2026, 9, 23, 4, 0, 0) / 1000);
  });

  it("defaults announcement off and page size 20", () => {
    const parsed = siteConfigSchema.parse({});
    expect(parsed.announcement.enabled).toBe(false);
    expect(parsed.announcement.id).toBe("default");
  });

  it("validates post page pagination and onlyOp", () => {
    const parsed = postPageSchema.parse({ items: [], page: 1, perPage: 20, total: 1, totalPages: 1, onlyOp: false });
    expect(parsed.onlyOp).toBe(false);
    expect(postPageSchema.safeParse({ items: [], page: 1, perPage: 20, total: 1, totalPages: 1 }).success).toBe(false);
  });

  it("validates search sort", () => {
    expect(searchSortSchema.parse("latest")).toBe("latest");
    expect(searchSortSchema.safeParse("hot").success).toBe(false);
  });

  it("validates tag detail stats", () => {
    const parsed = tagDetailSchema.parse({
      id: "t", slug: "s", name: "n", color: "#fff", usageCount: 1,
      description: "d", stats: { topics: 1, todayTopics: 0, replies: 2 },
    });
    expect(parsed.stats.replies).toBe(2);
  });

  it("validates admin overview shape", () => {
    const parsed = adminOverviewSchema.parse({
      todayPosts: 1, pendingReports: 0, newMembersWeek: 2, emailFailures: 0,
      configVersion: "1", lastDeployAt: null, pendingReportItems: [],
    });
    expect(parsed.pendingReportItems).toEqual([]);
  });
});
