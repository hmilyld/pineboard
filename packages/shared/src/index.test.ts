import { describe, expect, it } from "vitest";
import { fail, healthSchema, ok } from "./index";

describe("api envelope", () => {
  it("wraps success without meta", () => {
    expect(ok({ a: 1 })).toEqual({ ok: true, data: { a: 1 } });
  });

  it("wraps success with meta", () => {
    expect(ok("x", { page: 1 })).toEqual({ ok: true, data: "x", meta: { page: 1 } });
  });

  it("keeps field errors", () => {
    expect(fail("validation_error", "bad", { title: ["required"] })).toEqual({
      ok: false,
      error: { code: "validation_error", message: "bad", fields: { title: ["required"] } },
    });
  });
});

describe("health contract", () => {
  const valid = {
    status: "ok",
    version: "dev",
    environment: "development",
    db: true,
    r2: true,
    now: 1_792_000_000,
    configVersion: "0",
    turnstileConfigured: true,
  };

  it("accepts a valid payload", () => {
    expect(healthSchema.parse(valid)).toEqual(valid);
  });

  it("rejects a missing binding flag", () => {
    const { db: _db, ...rest } = valid;
    expect(() => healthSchema.parse(rest)).toThrow();
  });
});
