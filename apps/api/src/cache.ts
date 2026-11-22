import type { Context } from "hono";
import type { AppEnv } from "./env";

/**
 * Edge cache for endpoints whose body does not depend on the visitor.
 *
 * D1's free tier counts rows read against a hard daily cap and fails queries
 * once it is reached, so the cheapest query is the one that never reaches the
 * database. Entries live in the data center that created them (the Cache API
 * does not replicate) and refresh on the TTL instead of on every request.
 *
 * `s-maxage` keeps the entry out of a browser's private cache — the edge is
 * the only shared cache here — so a stale body cannot outlive the TTL in a
 * visitor's tab.
 */
export const CACHE_TTL = {
  /** Site counters shown in the footer; exact values are not worth a query. */
  stats: 300,
  /** Public configuration; settings edits already have a 45s isolate cache. */
  config: 60,
  /** Category/tag listings; counts update from the write path, lists from TTL. */
  lists: 60,
  /** Topic list; short so a freshly posted topic shows up almost at once. */
  topics: 20,
  /** Search results are user-independent and rate-limited upstream. */
  search: 30,
} as const;

/** Body plus the moment it was produced, so freshness can outlive the entry. */
type CachedEntry = { at: number; body: string };

/**
 * Caching is production-only: the e2e suites rewrite content and settings
 * between requests, and a cached body would hide those changes from them.
 */
export function cacheEnabled(c: Context<AppEnv>): boolean {
  return c.env.ENVIRONMENT === "production" && typeof caches !== "undefined";
}

function cacheKey(c: Context<AppEnv>): Request {
  // No headers on the key request: the cache entry is shared by every visitor,
  // so it must not vary by cookie or accept-encoding.
  return new Request(new URL(c.req.url).toString(), { method: "GET" });
}

/**
 * How long an entry is kept, in seconds. Longer than its freshness window so a
 * stale copy is still there to serve when D1 answers with an error — on the
 * free tier the alternative is a 500 for every visitor until midnight UTC.
 */
function storageTtl(ttlSeconds: number): number {
  return Math.max(ttlSeconds * 6, 600);
}

function jsonResponse(body: string, ttlSeconds: number, cacheState: "hit" | "miss" | "stale"): Response {
  return new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=0, s-maxage=${ttlSeconds}`,
      // Observable in production: without it a cache that silently never
      // stores anything looks exactly like one that works.
      "x-pineboard-cache": cacheState,
    },
  });
}

async function readEntry(response: Response | undefined): Promise<CachedEntry | null> {
  if (!response) return null;
  try {
    const parsed = (await response.json()) as Partial<CachedEntry>;
    if (typeof parsed?.at === "number" && typeof parsed?.body === "string") {
      return { at: parsed.at, body: parsed.body };
    }
  } catch {
    // A malformed entry is treated as a miss.
  }
  return null;
}

/**
 * Serve `produce()` through the edge cache. Returning a `Response` from
 * `produce` opts out of caching for that call, which is how the `:slug` routes
 * keep their 404s out of the cache.
 */
export async function cachedJson<T>(
  c: Context<AppEnv>,
  ttlSeconds: number,
  produce: () => Promise<T | Response> | T | Response,
): Promise<Response> {
  const enabled = cacheEnabled(c);
  const key = cacheKey(c);
  let entry: CachedEntry | null = null;

  if (enabled) {
    try {
      entry = await readEntry(await caches.default.match(key));
    } catch {
      // A cache read must never take the request down; fall through to D1.
    }
    if (entry && Math.floor(Date.now() / 1000) - entry.at < ttlSeconds) {
      return jsonResponse(entry.body, ttlSeconds, "hit");
    }
  }

  let body: string;
  try {
    const result = await produce();
    if (result instanceof Response) return result;
    body = JSON.stringify(result);
  } catch (error) {
    // The daily read/write cap makes D1 fail hard rather than bill overage.
    // A slightly old page beats a blank one, so fall back to the last copy —
    // but say so in the logs, otherwise a broken query hides behind stale rows.
    if (entry) {
      console.warn(
        JSON.stringify({
          level: "warn",
          job: "cache.stale",
          path: new URL(c.req.url).pathname,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      return jsonResponse(entry.body, ttlSeconds, "stale");
    }
    throw error;
  }

  if (enabled) {
    const stored = JSON.stringify({ at: Math.floor(Date.now() / 1000), body } satisfies CachedEntry);
    const response = new Response(stored, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": `public, max-age=0, s-maxage=${storageTtl(ttlSeconds)}`,
      },
    });
    try {
      c.executionCtx.waitUntil(
        caches.default.put(key, response).catch((error: unknown) => {
          console.warn(
            JSON.stringify({
              level: "warn",
              job: "cache.put",
              path: new URL(c.req.url).pathname,
              message: error instanceof Error ? error.message : String(error),
            }),
          );
        }),
      );
    } catch {
      // Without an ExecutionContext (unit tests) the response is still valid.
    }
  }
  return jsonResponse(body, ttlSeconds, "miss");
}

/**
 * Drop cached entries in the current data center. Writes call this so an
 * author sees their own change immediately; other data centers catch up on
 * the TTL, which is why the TTLs stay short.
 */
export async function purgeCache(c: Context<AppEnv>, path: string): Promise<void> {
  if (!cacheEnabled(c)) return;
  try {
    const url = new URL(path, c.req.url);
    await caches.default.delete(new Request(url.toString(), { method: "GET" }));
  } catch {
    // Best effort: the TTL is the backstop.
  }
}

/** Fire-and-forget purge that works with or without an ExecutionContext. */
export function purgeCaches(c: Context<AppEnv>, paths: string[]): void {
  if (!cacheEnabled(c)) return;
  const work = Promise.all(paths.map((path) => purgeCache(c, path)));
  try {
    c.executionCtx.waitUntil(work);
  } catch {
    void work;
  }
}
