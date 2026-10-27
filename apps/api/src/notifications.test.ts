import { describe, expect, it } from "vitest";
import { DEFAULT_EMAIL_PREFS, getEmailPreferences, setEmailPreferences } from "./notifications";

function emptyDb(): D1Database {
  const statement = {
    bind: () => statement,
    all: async () => ({ results: [] }),
  };
  return {
    prepare: () => statement,
    batch: async (statements: unknown[]) => statements,
  } as unknown as D1Database;
}

describe("email notification preferences", () => {
  it("defaults every email category to off", async () => {
    expect(DEFAULT_EMAIL_PREFS).toEqual({
      topic_reply: false,
      post_reply: false,
      mention: false,
      moderation: false,
    });
    await expect(getEmailPreferences(emptyDb(), "user-1")).resolves.toEqual(DEFAULT_EMAIL_PREFS);
  });

  it("keeps moderation off unless it is explicitly enabled", async () => {
    await expect(setEmailPreferences(emptyDb(), "user-1", { topic_reply: true })).resolves.toEqual({
      topic_reply: true,
      post_reply: false,
      mention: false,
      moderation: false,
    });
    await expect(setEmailPreferences(emptyDb(), "user-1", { moderation: true })).resolves.toEqual({
      topic_reply: false,
      post_reply: false,
      mention: false,
      moderation: true,
    });
  });
});
