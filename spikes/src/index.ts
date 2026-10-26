import { Hono } from "hono";
import { AwsClient } from "aws4fetch";
import { createAuth } from "./auth";
import { resetTrace, traceEntries, traceSummary } from "./trace";
import { bigramTokens, likePattern, needsLikeFallback } from "./search";
import type { Env } from "./env";

const app = new Hono<{ Bindings: Env }>();

app.get("/spike/health", (c) =>
  c.json({ ok: true, data: { now: Math.floor(Date.now() / 1000), env: c.env.ENVIRONMENT } }),
);

app.post("/spike/reset", async (c) => {
  resetTrace();
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM session"),
    c.env.DB.prepare("DELETE FROM account"),
    c.env.DB.prepare("DELETE FROM verification"),
    c.env.DB.prepare('DELETE FROM "rateLimit"'),
    c.env.DB.prepare("DELETE FROM post_revisions"),
    c.env.DB.prepare("DELETE FROM post_search"),
    c.env.DB.prepare("DELETE FROM posts"),
    c.env.DB.prepare("DELETE FROM topics"),
    c.env.DB.prepare("DELETE FROM categories"),
    c.env.DB.prepare('DELETE FROM "user"'),
    c.env.DB.prepare("DELETE FROM spike_outbox"),
  ]);
  return c.json({ ok: true, data: { reset: true } });
});

app.get("/spike/trace", (c) => c.json({ ok: true, data: traceSummary() }));

app.post("/spike/ratelimit/clear", async (c) => {
  await c.env.DB.prepare('DELETE FROM "rateLimit"').run();
  return c.json({ ok: true, data: { cleared: true } });
});

app.get("/spike/cpu/probe", async (c) => {
  const wallStart = performance.now();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("probe-pepper"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  for (let i = 0; i < 1000; i++) {
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`probe-${i}`));
  }
  return c.json({
    ok: true,
    data: {
      // workerd does not expose process.cpuUsage; wall time is recorded as an
      // upper bound only.
      cpuUsageAvailable: false,
      userMicros: null,
      systemMicros: null,
      wallMs: Number((performance.now() - wallStart).toFixed(3)),
      operations: 1000,
    },
  });
});

app.get("/spike/inspect", async (c) => {
  const db = c.env.DB;
  const [users, accounts, sessions, verifications, rateLimits, outbox, revisions, counts] = await db.batch([
    db.prepare(
      'SELECT id, name, email, email_verified, username, role, status, created_at, updated_at FROM "user" ORDER BY created_at',
    ),
    db.prepare(
      "SELECT id, user_id, provider_id, account_id, password IS NOT NULL AS has_password, length(password) AS password_length, created_at FROM account ORDER BY created_at",
    ),
    db.prepare("SELECT id, user_id, token, expires_at, created_at FROM session ORDER BY created_at"),
    db.prepare("SELECT id, identifier, value, expires_at FROM verification ORDER BY identifier"),
    db.prepare('SELECT key, count, last_request FROM "rateLimit" ORDER BY key'),
    db.prepare("SELECT id, kind, payload, created_at FROM spike_outbox ORDER BY created_at"),
    db.prepare("SELECT COUNT(*) AS revisions FROM post_revisions"),
    db.prepare(
      "SELECT (SELECT COUNT(*) FROM topics) AS topics, (SELECT COUNT(*) FROM posts) AS posts, (SELECT COUNT(*) FROM post_search) AS fts_rows",
    ),
  ]);

  return c.json({
    ok: true,
    data: {
      users: users.results,
      accounts: accounts.results,
      sessions: sessions.results,
      verifications: (verifications.results as Array<Record<string, unknown>>).map((row) => ({
        ...row,
        // Spike-only: surface token length/prefix, never log token values in production.
        valueLength: String(row.value).length,
        valuePrefix: String(row.value).slice(0, 12),
      })),
      rateLimits: rateLimits.results,
      outbox: outbox.results,
      revisions: revisions.results[0],
      counts: counts.results[0],
    },
  });
});

app.post("/spike/oauth/token", async (c) => {
  const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
  const code = String((form as Record<string, unknown>).code ?? "");
  const encoded = code.startsWith("spike:") ? code.slice("spike:".length) : code;
  return c.json({
    access_token: `spike-access:${encoded}`,
    token_type: "Bearer",
    expires_in: 3600,
    scope: "email profile",
  });
});

app.get("/spike/oauth/authorize", (c) => c.json({ ok: true, data: { authorize: false } }));
app.get("/spike/oauth/userinfo", (c) => c.json({ ok: true, data: { userinfo: false } }));
app.get("/spike/oauth/done", (c) => c.json({ ok: true, data: { oauth: "done" } }));

// Real Better Auth handler. txEnabled=1 forces the Drizzle adapter's
// interactive transaction path so the failure mode is observable.
app.on(["GET", "POST"], "/api/auth/*", async (c) => {
  resetTrace();
  const transaction = c.req.header("x-spike-tx") === "1";
  const requireLocalEmailVerified = c.req.header("x-spike-require-verified") !== "0";
  const guardUnverifiedLink = c.req.header("x-spike-guard") === "1";
  const auth = createAuth(c.env, c.executionCtx, { transaction, requireLocalEmailVerified, guardUnverifiedLink });
  const wallStart = performance.now();
  try {
    const response = await auth.handler(c.req.raw);
    response.headers.set("x-spike-wall-ms", (performance.now() - wallStart).toFixed(3));
    return response;
  } catch (error) {
    return c.json(
      {
        ok: false,
        error: {
          code: "spike_auth_exception",
          message: error instanceof Error ? error.message : String(error),
        },
      },
      500,
    );
  }
});

app.get("/spike/trace-after", (c) => c.json({ ok: true, data: { count: traceEntries().length } }));

// ---- Spike 3: FTS5 + batch + CAS -------------------------------------------------

app.post("/spike/fts/seed", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    id?: string;
    title?: string;
    content?: string;
  };
  const now = Math.floor(Date.now() / 1000);
  const topicId = body.id ?? crypto.randomUUID();
  const postId = crypto.randomUUID();
  const categoryId = "cat-spike";
  const title = body.title ?? "游戏攻略分享";
  const content = body.content ?? "Elden Ring 攻略：先击败接肢贵族，再前往魔法学院。";
  const db = c.env.DB;
  await db.batch([
    db
      .prepare("INSERT OR IGNORE INTO categories (id, slug, name, created_at) VALUES (?, ?, ?, ?)")
      .bind(categoryId, "spike", "Spike", now),
    db
      .prepare(
        "INSERT INTO topics (id, category_id, author_id, first_post_id, status, last_post_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'published', ?, ?, ?)",
      )
      .bind(topicId, categoryId, "spike-user", postId, now, now, now),
    db
      .prepare(
        "INSERT INTO posts (id, topic_id, author_id, floor, is_first, title, content_md, content_text, status, created_at, updated_at) VALUES (?, ?, 'spike-user', 1, 1, ?, ?, ?, 'published', ?, ?)",
      )
      .bind(postId, topicId, title, content, content, now, now),
    db
      .prepare("INSERT INTO post_search (post_uid, topic_id, title, tokens) VALUES (?, ?, ?, ?)")
      .bind(postId, topicId, title, bigramTokens(`${title} ${content}`)),
  ]);
  return c.json({ ok: true, data: { topicId, postId } });
});

app.get("/spike/fts/raw", async (c) => {
  const result = await c.env.DB.prepare(
    "SELECT rowid, post_uid, topic_id, title, tokens FROM post_search ORDER BY rowid LIMIT 50",
  ).all();
  return c.json({ ok: true, data: { rows: result.results } });
});

app.post("/spike/fts/seed-status", async (c) => {
  const body = (await c.req.json()) as { status?: string; title?: string; content?: string };
  const status = body.status === "hidden" || body.status === "deleted" ? body.status : "hidden";
  const now = Math.floor(Date.now() / 1000);
  const topicId = crypto.randomUUID();
  const postId = crypto.randomUUID();
  const title = body.title ?? `不可见主题 ${status}`;
  const content = body.content ?? `不可见内容 ${status}`;
  const db = c.env.DB;
  await db.batch([
    db
      .prepare(
        "INSERT OR IGNORE INTO categories (id, slug, name, created_at) VALUES ('cat-spike', 'spike', 'Spike', ?)",
      )
      .bind(now),
    db
      .prepare(
        "INSERT INTO topics (id, category_id, author_id, first_post_id, status, last_post_at, created_at, updated_at) VALUES (?, 'cat-spike', 'spike-user', ?, ?, ?, ?, ?)",
      )
      .bind(topicId, postId, status, now, now, now),
    db
      .prepare(
        "INSERT INTO posts (id, topic_id, author_id, floor, is_first, title, content_md, content_text, status, created_at, updated_at) VALUES (?, ?, 'spike-user', 1, 1, ?, ?, ?, ?, ?, ?)",
      )
      .bind(postId, topicId, title, content, content, status, now, now),
    db
      .prepare("INSERT INTO post_search (post_uid, topic_id, title, tokens) VALUES (?, ?, ?, ?)")
      .bind(postId, topicId, title, bigramTokens(`${title} ${content}`)),
  ]);
  return c.json({ ok: true, data: { topicId, postId, status } });
});

app.get("/spike/fts/search", async (c) => {
  const q = c.req.query("q") ?? "";
  const tokens = bigramTokens(q);
  const db = c.env.DB;
  if (!tokens || needsLikeFallback(q)) {
    const pattern = likePattern(q);
    const result = await db
      .prepare(
        `SELECT p.id AS postId, p.topic_id AS topicId, p.title,
                substr(p.content_text, 1, 80) AS snippet
           FROM posts p JOIN topics t ON t.id = p.topic_id
          WHERE p.status = 'published' AND t.status = 'published'
            AND (p.title LIKE ? ESCAPE '\\' OR p.content_text LIKE ? ESCAPE '\\')
          LIMIT 20`,
      )
      .bind(pattern, pattern)
      .all();
    return c.json({ ok: true, data: { mode: "like", q, tokens, rows: result.results, meta: result.meta } });
  }
  // Phrase query: escape double quotes by doubling, never interpolate raw q.
  const phrase = `"${tokens.replace(/"/g, '""')}"`;
  const result = await db
    .prepare(
      `SELECT p.id AS postId, p.topic_id AS topicId, p.title,
              substr(p.content_text, 1, 80) AS snippet, bm25(post_search) AS rank
         FROM post_search
         JOIN posts p ON p.id = post_search.post_uid
         JOIN topics t ON t.id = p.topic_id
        WHERE post_search MATCH ?
          AND p.status = 'published' AND t.status = 'published'
        ORDER BY rank LIMIT 20`,
    )
    .bind(phrase)
    .all();
  return c.json({ ok: true, data: { mode: "fts", q, tokens, phrase, rows: result.results, meta: result.meta } });
});

app.post("/spike/fts/edit", async (c) => {
  const body = (await c.req.json()) as {
    postId: string;
    expectedVersion: number;
    title?: string;
    content?: string;
  };
  const now = Math.floor(Date.now() / 1000);
  const db = c.env.DB;
  const title = body.title ?? null;
  const content = body.content ?? "updated";
  let upd: D1Result;
  try {
    const results = await db.batch([
      db
        .prepare(
          `INSERT INTO post_revisions (id, topic_id, post_id, version, title, content_md, action, editor_id, reason, created_at)
           SELECT ?, p.topic_id, p.id, p.version, p.title, p.content_md, 'edit', ?, ?, ?
             FROM posts p WHERE p.id = ? AND p.version = ?`,
        )
        .bind(crypto.randomUUID(), "spike-editor", "spike", now, body.postId, body.expectedVersion),
      db
        .prepare(
          `DELETE FROM post_search WHERE post_uid = ?
             AND EXISTS (SELECT 1 FROM posts WHERE id = ? AND version = ?)`,
        )
        .bind(body.postId, body.postId, body.expectedVersion),
      db
        .prepare(
          `INSERT INTO post_search (post_uid, topic_id, title, tokens)
           SELECT p.id, p.topic_id, COALESCE(?, p.title), ?
             FROM posts p WHERE p.id = ? AND p.version = ?`,
        )
        .bind(title, bigramTokens(`${title ?? ""} ${content}`), body.postId, body.expectedVersion),
      db
        .prepare(
          `UPDATE posts SET title = COALESCE(?, title), content_md = ?, content_text = ?,
                  version = version + 1, edit_count = edit_count + 1, edited_at = ?, updated_at = ?
            WHERE id = ? AND version = ?`,
        )
        .bind(title, content, content, now, now, body.postId, body.expectedVersion),
    ]);
    upd = results[3] as D1Result;
  } catch (error) {
    return c.json(
      { ok: false, error: { code: "batch_failed", message: error instanceof Error ? error.message : String(error) } },
      500,
    );
  }
  return c.json({
    ok: true,
    data: {
      changes: upd.meta.changes,
      versionConflict: upd.meta.changes === 0,
    },
  });
});

app.post("/spike/fts/batch-atomic", async (c) => {
  const db = c.env.DB;
  const now = Math.floor(Date.now() / 1000);
  const before = await db.prepare("SELECT COUNT(*) AS n FROM post_revisions").first<{ n: number }>();
  await db
    .prepare("INSERT OR IGNORE INTO categories (id, slug, name, created_at) VALUES ('atomic-cat', 'atomic-cat', 'Atomic', ?)")
    .bind(now)
    .run();
  let failed = false;
  let message = "";
  try {
    await db.batch([
      db
        .prepare(
          "INSERT INTO post_revisions (id, topic_id, post_id, version, title, content_md, action, editor_id, created_at) VALUES (?, 'atomic-topic', 'atomic-post', 1, 't', 'c', 'edit', 'e', ?)",
        )
        .bind(crypto.randomUUID(), now),
      // Duplicate primary key: the whole batch must roll back.
      db
        .prepare("INSERT INTO categories (id, slug, name, created_at) VALUES ('atomic-cat', 'atomic-cat-2', 'Atomic 2', ?)")
        .bind(now),
    ]);
  } catch (error) {
    failed = true;
    message = error instanceof Error ? error.message : String(error);
  }
  const after = await db.prepare("SELECT COUNT(*) AS n FROM post_revisions").first<{ n: number }>();
  return c.json({
    ok: true,
    data: { failed, message, revisionsBefore: before?.n ?? 0, revisionsAfter: after?.n ?? 0, atomic: (before?.n ?? 0) === (after?.n ?? 0) },
  });
});

app.post("/spike/fts/floor", async (c) => {
  const body = (await c.req.json()) as { topicId: string; content?: string };
  const db = c.env.DB;
  const postId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  try {
    const result = await db
      .prepare(
        `INSERT INTO posts (id, topic_id, author_id, floor, is_first, title, content_md, content_text, status, created_at, updated_at)
         VALUES (?, ?, 'spike-user',
                 (SELECT COALESCE(MAX(floor), 0) + 1 FROM posts WHERE topic_id = ?),
                 0, NULL, ?, ?, 'published', ?, ?)
         RETURNING floor`,
      )
      .bind(postId, body.topicId, body.topicId, body.content ?? "reply", body.content ?? "reply", now, now)
      .first();
    return c.json({ ok: true, data: { floor: result?.floor, postId } });
  } catch (error) {
    return c.json(
      { ok: false, error: { code: "floor_conflict", message: error instanceof Error ? error.message : String(error) } },
      409,
    );
  }
});

// ---- Spike 1: single Worker document meta injection ------------------------------

function assetUrl(requestUrl: string): string {
  return new URL("/index.html", requestUrl).toString();
}

app.get("/t/:id", async (c) => {
  const started = performance.now();
  const id = c.req.param("id");

  const cache = caches.default;
  const configVersion = "spike-1";
  const cacheKey = new Request(`https://spike.internal/doc/${encodeURIComponent(id)}?v=${configVersion}`);
  const cached = await cache.match(cacheKey);
  if (cached) {
    const hit = new Response(cached.body, cached);
    hit.headers.set("x-spike-cache", "hit");
    hit.headers.set("server-timing", `total;dur=${(performance.now() - started).toFixed(2)}`);
    return hit;
  }

  const d1Start = performance.now();
  const d1Result = await c.env.DB.prepare(
    `SELECT t.id, t.status AS topic_status, p.title, p.content_text, t.created_at, t.updated_at
       FROM topics t JOIN posts p ON p.topic_id = t.id AND p.is_first = 1
      WHERE t.id = ?`,
  )
    .bind(id)
    .all<{
      id: string;
      topic_status: string;
      title: string;
      content_text: string;
      created_at: number;
      updated_at: number;
    }>();
  const row = d1Result.results[0];
  const d1Ms = performance.now() - d1Start;

  const visible = row && row.topic_status === "published";
  const title = visible ? row.title : "主题不存在";
  const description = visible ? row.content_text.slice(0, 120) : "该主题不存在或已被删除";
  const canonical = `${c.env.SITE_URL}/t/${id}`;
  const status = !row ? 404 : row.topic_status === "deleted" ? 410 : visible ? 200 : 404;

  const asset = await c.env.ASSETS.fetch(new Request(assetUrl(c.req.url), { headers: c.req.raw.headers }));
  const jsonLd = visible
    ? {
        "@context": "https://schema.org",
        "@type": "DiscussionForumPosting",
        headline: title,
        datePublished: new Date(row.created_at * 1000).toISOString(),
        dateModified: new Date(row.updated_at * 1000).toISOString(),
        url: canonical,
      }
    : null;

  let rewriter = new HTMLRewriter()
    .on("title", {
      element(el) {
        el.setInnerContent(title);
      },
    })
    .on('meta[name="description"]', {
      element(el) {
        el.setAttribute("content", description);
      },
    })
    .on('meta[property="og:title"]', {
      element(el) {
        el.setAttribute("content", title);
      },
    })
    .on('meta[property="og:description"]', {
      element(el) {
        el.setAttribute("content", description);
      },
    })
    .on('meta[property="og:url"]', {
      element(el) {
        el.setAttribute("content", canonical);
      },
    })
    .on('meta[name="twitter:title"]', {
      element(el) {
        el.setAttribute("content", title);
      },
    })
    .on('meta[name="twitter:description"]', {
      element(el) {
        el.setAttribute("content", description);
      },
    })
    .on('link[rel="canonical"]', {
      element(el) {
        el.setAttribute("href", canonical);
      },
    });
  if (jsonLd) {
    const safe = JSON.stringify(jsonLd).replace(/</g, "\\u003c");
    rewriter = rewriter.on("#spike-jsonld", {
      element(el) {
        el.setInnerContent(safe);
      },
    });
  }

  const response = rewriter.transform(
    new Response(asset.body, {
      status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": visible ? "public, max-age=300" : "no-store",
        "x-spike-cache": "miss",
        "server-timing": `total;dur=${(performance.now() - started).toFixed(2)}, d1;dur=${d1Ms.toFixed(2)}`,
        "x-spike-d1-rows-read": String(d1Result.meta.rows_read ?? ""),
        "x-spike-d1-rows-written": String(d1Result.meta.rows_written ?? ""),
      },
    }),
  );

  if (visible) {
    const toCache = new Response(response.clone().body, response);
    toCache.headers.delete("server-timing");
    await cache.put(cacheKey, toCache);
  }
  return response;
});

// ---- Spike 4: R2 presign + HEAD verification --------------------------------------

const ALLOWED_UPLOAD_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "application/zip",
]);

function validateUpload(key: string, mime: string, size: number) {
  if (!/^[A-Za-z0-9/_.-]{1,200}$/.test(key) || key.includes("..") || key.startsWith("/")) return "invalid_key";
  if (!ALLOWED_UPLOAD_MIME.has(mime)) return "mime_not_allowed";
  if (size <= 0 || size > 10 * 1024 * 1024) return "size_out_of_range";
  return null;
}

app.post("/spike/r2/sign", async (c) => {
  const body = (await c.req.json()) as { key?: string; mime?: string; size?: number };
  const key = body.key ?? "";
  const mime = body.mime ?? "";
  const size = Number(body.size ?? 0);
  const invalid = validateUpload(key, mime, size);
  if (invalid) {
    return c.json({ ok: false, error: { code: invalid, message: invalid } }, 400);
  }
  const client = new AwsClient({
    accessKeyId: c.env.R2_ACCESS_KEY_ID,
    secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
    service: "s3",
    region: "auto",
  });
  const endpoint = new URL(
    `https://${c.env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com/${c.env.R2_BUCKET_NAME}/${key}`,
  );
  endpoint.searchParams.set("X-Amz-Expires", "600");
  const request = new Request(endpoint, {
    method: "PUT",
    headers: { "content-type": mime },
  });
  const signed = await client.sign(request, { aws: { signQuery: true, allHeaders: true } });
  return c.json({
    ok: true,
    data: {
      method: "PUT",
      url: signed.url,
      headers: { "content-type": mime },
      expiresInSeconds: 600,
      // Browser cannot set Content-Length; size is enforced by HEAD on complete.
      contentLengthSigned: signed.url.includes("content-length"),
      signedHeaders: new URL(signed.url).searchParams.get("X-Amz-SignedHeaders"),
    },
  });
});

app.post("/spike/r2/local-put", async (c) => {
  const key = c.req.query("key") ?? "";
  const mime = c.req.query("mime") ?? "application/octet-stream";
  if (validateUpload(key, mime, 1)) {
    return c.json({ ok: false, error: { code: "invalid_upload", message: "invalid upload request" } }, 400);
  }
  const bytes = await c.req.arrayBuffer();
  const object = await c.env.BUCKET.put(key, bytes, {
    httpMetadata: {
      contentType: mime,
      contentDisposition: mime.startsWith("image/") ? "inline" : "attachment",
    },
  });
  return c.json({ ok: true, data: { key, size: object?.size ?? bytes.byteLength, etag: object?.etag } });
});

app.get("/spike/r2/head", async (c) => {
  const key = c.req.query("key") ?? "";
  const object = await c.env.BUCKET.head(key);
  if (!object) return c.json({ ok: false, error: { code: "not_found", message: "object not found" } }, 404);
  return c.json({
    ok: true,
    data: {
      key,
      size: object.size,
      mime: object.httpMetadata?.contentType ?? null,
      etag: object.etag,
      uploaded: object.uploaded.toISOString(),
    },
  });
});

app.post("/spike/r2/complete", async (c) => {
  const body = (await c.req.json()) as {
    key?: string;
    declaredSize?: number;
    declaredMime?: string;
    maxSize?: number;
  };
  const key = body.key ?? "";
  const declaredSize = Number(body.declaredSize ?? 0);
  const declaredMime = body.declaredMime ?? "";
  const maxSize = Number(body.maxSize ?? 5 * 1024 * 1024);
  const head = await c.env.BUCKET.head(key);
  if (!head) {
    return c.json({ ok: false, error: { code: "not_found", message: "object not found" } }, 404);
  }
  const actualMime = head.httpMetadata?.contentType ?? "";
  const reasons: string[] = [];
  if (!ALLOWED_UPLOAD_MIME.has(actualMime)) reasons.push("mime_not_allowed");
  if (actualMime !== declaredMime) reasons.push("mime_mismatch");
  if (head.size > maxSize) reasons.push("exceeds_max");
  if (head.size > declaredSize) reasons.push("exceeds_declared");
  if (head.size === 0) reasons.push("empty");
  if (reasons.length > 0) {
    await c.env.BUCKET.delete(key);
    return c.json(
      { ok: false, error: { code: "upload_rejected", message: reasons.join(","), fields: { reasons } } },
      400,
    );
  }
  return c.json({
    ok: true,
    data: { key, size: head.size, mime: actualMime, etag: head.etag, contentDisposition: head.httpMetadata?.contentDisposition ?? null },
  });
});

app.get("/spike/cache/flush", async (c) => {
  const id = c.req.query("id");
  if (id) await caches.default.delete(new Request(`https://spike.internal/doc/${encodeURIComponent(id)}?v=spike-1`));
  return c.json({ ok: true, data: { flushed: Boolean(id) } });
});

app.notFound((c) => c.json({ ok: false, error: { code: "not_found", message: "no spike route" } }, 404));

export default app;
