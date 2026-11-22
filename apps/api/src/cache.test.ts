import { describe, expect, it, vi } from "vitest";
import type { Context } from "hono";
import type { AppEnv } from "./env";
import { CACHE_TTL, cacheEnabled, cachedJson, purgeCaches } from "./cache";

function fakeContext(environment: string, url = "https://forum.example.com/api/tags") {
  return {
    env: { ENVIRONMENT: environment },
    req: { url, header: () => undefined },
    json: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
    executionCtx: { waitUntil: (work: Promise<unknown>) => void work },
  } as unknown as Context<AppEnv>;
}

/** Minimal stand-in for the Workers cache: one entry per URL, no expiry. */
function fakeCaches() {
  const store = new Map<string, Response>();
  const cache = {
    match: async (request: Request) => store.get(request.url)?.clone(),
    put: async (request: Request, response: Response) => void store.set(request.url, response.clone()),
    delete: async (request: Request) => store.delete(request.url),
  };
  return { cache, store };
}

/** Put an envelope in the store as if it had been produced `ageSeconds` ago. */
function seed(store: Map<string, Response>, url: string, body: string, ageSeconds: number) {
  store.set(url, new Response(JSON.stringify({ at: Math.floor(Date.now() / 1000) - ageSeconds, body })));
}

async function withCaches(run: (store: Map<string, Response>) => Promise<void>) {
  const { cache, store } = fakeCaches();
  vi.stubGlobal("caches", { default: cache });
  try {
    await run(store);
  } finally {
    vi.unstubAllGlobals();
  }
}

describe("edge cache for public JSON", () => {
  it("stays off outside production so e2e suites see every write", () => {
    return withCaches(async () => {
      expect(cacheEnabled(fakeContext("development"))).toBe(false);
      expect(cacheEnabled(fakeContext("production"))).toBe(true);
    });
  });

  it("degrades to no caching where the runtime has no Cache API", () => {
    expect(cacheEnabled(fakeContext("production"))).toBe(false);
  });

  it("recomputes on every request when disabled", async () => {
    const produce = vi.fn(async () => ({ ok: true, data: [1, 2] }));
    const c = fakeContext("development");
    const first = await cachedJson(c, CACHE_TTL.lists, produce);
    const second = await cachedJson(c, CACHE_TTL.lists, produce);
    expect(produce).toHaveBeenCalledTimes(2);
    expect(await first.json()).toEqual(await second.json());
    expect(first.headers.get("cache-control")).toBe(`public, max-age=0, s-maxage=${CACHE_TTL.lists}`);
    expect(first.headers.get("x-pineboard-cache")).toBe("miss");
  });

  it("serves the stored body until the entry is purged", () =>
    withCaches(async (store) => {
      const produce = vi.fn(async () => ({ ok: true, data: ["fresh"] }));
      const c = fakeContext("production");
      const missed = await cachedJson(c, CACHE_TTL.lists, produce);
      expect(produce).toHaveBeenCalledTimes(1);
      expect(missed.headers.get("x-pineboard-cache")).toBe("miss");
      expect(store.size).toBe(1);

      const hit = await cachedJson(c, CACHE_TTL.lists, produce);
      expect(produce).toHaveBeenCalledTimes(1);
      expect(hit.headers.get("x-pineboard-cache")).toBe("hit");
      expect(await hit.json()).toEqual(await missed.json());

      purgeCaches(c, ["/api/tags"]);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await cachedJson(c, CACHE_TTL.lists, produce);
      expect(produce).toHaveBeenCalledTimes(2);
    }));

  it("recomputes once an entry is older than the TTL", () =>
    withCaches(async (store) => {
      seed(
        store,
        "https://forum.example.com/api/tags",
        JSON.stringify({ ok: true, data: ["old"] }),
        CACHE_TTL.lists + 1,
      );
      const produce = vi.fn(async () => ({ ok: true, data: ["new"] }));
      const response = await cachedJson(fakeContext("production"), CACHE_TTL.lists, produce);
      expect(produce).toHaveBeenCalledTimes(1);
      expect(await response.json()).toEqual({ ok: true, data: ["new"] });
    }));

  it("serves the expired copy when the database fails", () =>
    withCaches(async (store) => {
      seed(store, "https://forum.example.com/api/tags", JSON.stringify({ ok: true, data: ["yesterday"] }), 3_600);
      const produce = vi.fn(async () => {
        throw new Error("Your account has exceeded D1's free tier daily row read limit.");
      });
      const response = await cachedJson(fakeContext("production"), CACHE_TTL.lists, produce);
      expect(response.status).toBe(200);
      expect(response.headers.get("x-pineboard-cache")).toBe("stale");
      expect(await response.json()).toEqual({ ok: true, data: ["yesterday"] });
    }));

  it("rethrows when the database fails and there is nothing cached", () =>
    withCaches(async () => {
      const produce = vi.fn(async () => {
        throw new Error("d1 down");
      });
      await expect(cachedJson(fakeContext("production"), CACHE_TTL.lists, produce)).rejects.toThrow("d1 down");
    }));

  it("lets a route opt out by returning a Response, so 404s are never stored", () =>
    withCaches(async (store) => {
      const produce = vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 404 }));
      const c = fakeContext("production");
      const first = await cachedJson(c, CACHE_TTL.lists, produce);
      const second = await cachedJson(c, CACHE_TTL.lists, produce);
      expect(first.status).toBe(404);
      expect(second.status).toBe(404);
      expect(produce).toHaveBeenCalledTimes(2);
      expect(store.size).toBe(0);
    }));
});
