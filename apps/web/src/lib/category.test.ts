import { describe, expect, it } from "vitest";
import { categoryClass, categoryStyle, sortLongLabel, sortTabLabel } from "./category";

describe("category helpers", () => {
  it("maps known slugs and falls back to the generic class", () => {
    expect(categoryClass("tools")).toBe("c-tool");
    expect(categoryClass("game")).toBe("c-game");
    expect(categoryClass("dev")).toBe("c-dev");
    expect(categoryClass(null)).toBe("c-gen");
    expect(categoryClass("unknown")).toBe("c-gen");
  });

  it("only sets --c-base when a color is present", () => {
    expect(categoryStyle("#14513f")).toEqual({ "--c-base": "#14513f" });
    expect(categoryStyle(null)).toEqual({});
  });

  it("resolves translated sort labels instead of raw keys", () => {
    expect(sortTabLabel("new")).not.toBe("topicSort.new");
    expect(sortTabLabel("unknown")).not.toBe("topicSort.latest");
    expect(sortLongLabel("hot")).not.toBe("topicSort.hot-long");
  });
});
