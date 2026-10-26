import { describe, expect, it } from "vitest";
import {
  DEFAULTS,
  configSchema,
  derivePassword,
  flattenConfigPatch,
  mergeDeep,
  parseConfigOverrides,
  toPublicConfig,
  UPLOAD_ARCHIVE_MIME,
  UPLOAD_IMAGE_MIME,
  ulid,
} from "./config";

describe("settings defaults", () => {
  it("parses the full defaults", () => {
    expect(configSchema.parse(DEFAULTS)).toEqual(DEFAULTS);
  });

  it("deep merges nested overrides and replaces arrays", () => {
    const merged = mergeDeep(DEFAULTS, {
      site: { name: "新论坛" },
      upload: { imageMaxMb: 3 },
    });
    expect(merged.site.name).toBe("新论坛");
    expect(merged.site.timezone).toBe("Asia/Shanghai");
    expect(merged.upload.imageMaxMb).toBe(3);
  });

  it("falls back per group instead of dropping every override", () => {
    const { config, errors } = parseConfigOverrides({
      site: { name: "OK" },
      account: { passwordMinLength: 1 },
    });
    expect(config.site.name).toBe("OK");
    expect(config.account.passwordMinLength).toBe(8);
    expect(errors.some((error) => error.group === "account")).toBe(true);
  });

  it("rejects unsafe theme tokens", () => {
    const result = configSchema.safeParse({
      ...DEFAULTS,
      theme: { ...DEFAULTS.theme, tokens: { "--x": "url(javascript:alert(1))" } },
    });
    expect(result.success).toBe(false);
  });

  it("flattens a patch into dotted settings keys", () => {
    expect(flattenConfigPatch({ site: { name: "A" }, account: { registrationOpen: false } })).toEqual([
      { path: "site.name", group: "site", value: "A" },
      { path: "account.registrationOpen", group: "account", value: false },
    ]);
  });

  it("public config does not expose mail or edit settings", () => {
    const publicConfig = toPublicConfig(DEFAULTS, 3, "test-key");
    expect(publicConfig.version).toBe("3");
    expect("mail" in publicConfig).toBe(false);
    expect("edit" in publicConfig).toBe(false);
  });

  it("disables public Turnstile when no Site Key is configured", () => {
    expect(toPublicConfig(DEFAULTS, 1, "").feature.turnstile).toBe(false);
    expect(toPublicConfig(DEFAULTS, 1, "site-key").feature.turnstile).toBe(true);
  });

  it("keeps public upload MIME lists in sync with the shared constants", () => {
    const publicConfig = toPublicConfig(DEFAULTS, 1, "site-key");
    expect(publicConfig.upload.imageTypes).toEqual([...UPLOAD_IMAGE_MIME]);
    expect(publicConfig.upload.attachmentTypes).toEqual([...UPLOAD_ARCHIVE_MIME]);
  });
});

describe("password and ids", () => {
  it("derives the documented v1 password format", async () => {
    const derived = await derivePassword("A@Example.test", "correct horse battery staple");
    expect(derived).toMatch(/^v1\$[A-Za-z0-9+/=]{43,}$/);
    expect(derived).toBe(await derivePassword("a@example.test", "correct horse battery staple"));
  });

  it("generates a 26-char Crockford ULID", () => {
    const id = ulid();
    expect(id).toHaveLength(26);
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });
});
