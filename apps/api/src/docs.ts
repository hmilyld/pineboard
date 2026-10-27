import { getConfig } from "./config";
import { getEffectiveIntegrations } from "./integrations";
import { copy, docLocale } from "./i18n";
import type { AppEnv } from "./env";
import type { Context, Hono } from "hono";

type DocMeta = {
  title: string;
  description: string;
  canonicalPath: string;
  status: number;
  jsonLd?: Record<string, unknown>;
  noindex?: boolean;
  cacheTag?: string;
  ogType?: "website" | "article";
  author?: string;
  publishedTime?: string;
  modifiedTime?: string;
};

const CSP = "default-src 'self'; script-src 'self' https://challenges.cloudflare.com https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://challenges.cloudflare.com https://static.cloudflareinsights.com https://*.r2.cloudflarestorage.com; frame-src https://challenges.cloudflare.com; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; worker-src 'self'";

function xmlEscape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function titleWithTemplate(title: string, template: string, siteName: string): string {
  if (!title) return siteName;
  return template.replaceAll("{title}", title).replaceAll("{siteName}", siteName);
}

function buildShell(asset: Response, meta: DocMeta, siteUrl: string, siteName: string, language: string, image?: string): Response {
  const canonical = `${siteUrl}${meta.canonicalPath}`;
  const json = meta.jsonLd ? JSON.stringify(meta.jsonLd).replace(/</g, "\\u003c") : null;
  let rewriter = new HTMLRewriter()
    .on("title", { element(el) { el.setInnerContent(meta.title); } })
    .on('meta[name="description"]', { element(el) { el.setAttribute("content", meta.description); } })
    .on('meta[name="robots"]', { element(el) { el.setAttribute("content", meta.noindex ? "noindex,nofollow" : "index,follow"); } })
    .on('meta[property="og:type"]', { element(el) { el.setAttribute("content", meta.ogType ?? "website"); } })
    .on('meta[property="og:site_name"]', { element(el) { el.setAttribute("content", siteName); } })
    .on('meta[property="og:locale"]', { element(el) { el.setAttribute("content", language.replace("-", "_")); } })
    .on('meta[property="og:title"]', { element(el) { el.setAttribute("content", meta.title); } })
    .on('meta[property="og:description"]', { element(el) { el.setAttribute("content", meta.description); } })
    .on('meta[property="og:url"]', { element(el) { el.setAttribute("content", canonical); } })
    .on('meta[name="twitter:title"]', { element(el) { el.setAttribute("content", meta.title); } })
    .on('meta[name="twitter:description"]', { element(el) { el.setAttribute("content", meta.description); } })
    .on('meta[name="twitter:card"]', { element(el) { el.setAttribute("content", image ? "summary_large_image" : "summary"); } })
    .on('meta[name="author"]', { element(el) { if (meta.author) el.setAttribute("content", meta.author); else el.remove(); } })
    .on('meta[property="article:published_time"]', { element(el) { if (meta.publishedTime) el.setAttribute("content", meta.publishedTime); else el.remove(); } })
    .on('meta[property="article:modified_time"]', { element(el) { if (meta.modifiedTime) el.setAttribute("content", meta.modifiedTime); else el.remove(); } })
    .on('meta[property="og:image"]', { element(el) { if (image) el.setAttribute("content", image); else el.remove(); } })
    .on('meta[name="twitter:image"]', { element(el) { if (image) el.setAttribute("content", image); else el.remove(); } })
    .on('link[rel="canonical"]', { element(el) { el.setAttribute("href", canonical); } })
    .on('link[rel="alternate"][hreflang="zh-CN"]', { element(el) { el.setAttribute("href", canonical); } });
  if (json) {
    rewriter = rewriter.on("#doc-jsonld", { element(el) { el.setInnerContent(json); } });
  }
  const headers = new Headers({
    "content-type": "text/html; charset=utf-8",
    "cache-control": meta.status === 200 ? "public, max-age=300" : "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "content-security-policy": CSP,
  });
  if (meta.noindex) headers.set("x-robots-tag", "noindex");
  return rewriter.transform(new Response(asset.body, { status: meta.status, headers }));
}

async function shell(c: { env: AppEnv["Bindings"]; req: { url: string; raw: Request } }): Promise<Response> {
  return c.env.ASSETS.fetch(new Request(new URL("/index.html", c.req.url), { headers: c.req.raw.headers }));
}

async function serveDoc(
  c: { env: AppEnv["Bindings"]; req: { url: string; raw: Request }; get(key: string): unknown },
  meta: DocMeta,
): Promise<Response> {
  const loaded = await getConfig(c.env);
  const config = loaded.config;
  const cache = caches.default;
  // The language is part of the key so switching it drops cached SSR shells.
  const version = `${loaded.version}-${c.env.CF_VERSION_METADATA?.id ?? "dev"}-${config.site.language}`;
  const key = new Request(
    `https://docs.internal${meta.canonicalPath}?v=${encodeURIComponent(version)}&tag=${encodeURIComponent(meta.cacheTag ?? "")}`,
  );
  if (meta.status === 200) {
    const cached = await cache.match(key);
    if (cached) {
      const hit = new Response(cached.body, cached);
      hit.headers.set("x-doc-cache", "hit");
      return hit;
    }
  }
  const asset = await shell(c);
  const integration = await getEffectiveIntegrations(c.env);
  const image = config.site.ogImageKey
    ? `${(integration.cloudflare.cdnUrl || config.site.url).replace(/\/$/, "")}/${config.site.ogImageKey.replace(/^\//, "")}`
    : undefined;
  const response = buildShell(
    asset,
    {
      ...meta,
      noindex: Boolean(meta.noindex || config.seo.noindex),
      title: meta.title === config.site.name ? config.site.name : titleWithTemplate(meta.title, config.seo.titleTemplate, config.site.name),
    },
    config.site.url.replace(/\/$/, ""),
    config.site.name,
    config.site.language,
    image,
  );
  response.headers.set("x-doc-cache", "miss");
  if (meta.status === 200) {
    const toCache = new Response(response.clone().body, response);
    await cache.put(key, toCache);
  }
  return response;
}

export function registerDocRoutes(app: Hono<AppEnv>): void {
  app.get("/", async (c) => {
    const loaded = await getConfig(c.env);
    const config = loaded.config;
    const site = config.site.url.replace(/\/$/, "");
    const latest = await c.env.DB.prepare("SELECT MAX(updated_at) AS updated_at FROM topics WHERE status = 'published'")
      .first<{ updated_at: number | null }>();
    const lastmod = latest?.updated_at ? new Date(Number(latest.updated_at) * 1000).toISOString() : undefined;
    return serveDoc(c, {
      title: config.seo.homeTitle || config.site.name,
      description: config.seo.description || config.site.description || config.site.tagline,
      canonicalPath: "/",
      status: 200,
      ogType: "website",
      cacheTag: `home-${loaded.version}`,
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: config.site.name,
        url: site,
        description: config.seo.description || config.site.description || config.site.tagline,
        inLanguage: config.site.language,
        potentialAction: {
          "@type": "SearchAction",
          target: `${site}/search?q={search_term_string}`,
          "query-input": "required name=search_term_string",
        },
      },
      ...(lastmod ? { modifiedTime: lastmod } : {}),
    });
  });

  app.get("/t/:id", async (c) => {
    const id = c.req.param("id");
    const row = await c.env.DB.prepare(
      `SELECT t.id, t.status, t.reply_count, t.like_count, t.view_count,
              p.title, p.content_text, p.created_at, t.updated_at, u.name AS author_name
         FROM topics t JOIN posts p ON p.topic_id = t.id AND p.is_first = 1
         JOIN user u ON u.id = t.author_id WHERE t.id = ?`,
    ).bind(id).first<{ id: string; status: string; reply_count: number; like_count: number; view_count: number; title: string; content_text: string; created_at: number; updated_at: number; author_name: string }>();
    const config = (await getConfig(c.env)).config;
    const locale = docLocale(config);
    if (!row) {
      return serveDoc(c, { title: copy("topicMissing", locale), description: copy("topicMissingOrDeleted", locale), canonicalPath: `/t/${id}`, status: 404, noindex: true });
    }
    if (row.status === "deleted") {
      return serveDoc(c, { title: copy("topicDeleted", locale), description: copy("topicDeletedBody", locale), canonicalPath: `/t/${id}`, status: 410, noindex: true });
    }
    if (row.status !== "published") {
      return serveDoc(c, { title: copy("topicMissing", locale), description: copy("topicMissingOrHidden", locale), canonicalPath: `/t/${id}`, status: 404, noindex: true });
    }
    const site = config.site.url.replace(/\/$/, "");
    const published = new Date(row.created_at * 1000).toISOString();
    const modified = new Date(row.updated_at * 1000).toISOString();
    return serveDoc(c, {
      title: row.title,
      description: row.content_text.slice(0, 160) || copy("topicDiscussion", locale, { title: row.title }),
      canonicalPath: `/t/${id}`,
      status: 200,
      ogType: "article",
      author: row.author_name,
      publishedTime: published,
      modifiedTime: modified,
      cacheTag: String(row.updated_at),
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "DiscussionForumPosting",
        headline: row.title,
        description: row.content_text.slice(0, 300),
        datePublished: published,
        dateModified: modified,
        author: { "@type": "Person", name: row.author_name },
        url: `${site}/t/${id}`,
        mainEntityOfPage: { "@type": "WebPage", "@id": `${site}/t/${id}` },
        isPartOf: { "@type": "WebSite", name: config.site.name, url: site },
        commentCount: Number(row.reply_count ?? 0),
        interactionStatistic: [
          { "@type": "InteractionCounter", interactionType: "https://schema.org/CommentAction", userInteractionCount: Number(row.reply_count ?? 0) },
          { "@type": "InteractionCounter", interactionType: "https://schema.org/LikeAction", userInteractionCount: Number(row.like_count ?? 0) },
          { "@type": "InteractionCounter", interactionType: "https://schema.org/WatchAction", userInteractionCount: Number(row.view_count ?? 0) },
        ],
      },
    });
  });

  app.get("/c/:slug", async (c) => {
    const slug = c.req.param("slug");
    const row = await c.env.DB.prepare("SELECT slug, name, description FROM categories WHERE slug = ? AND is_visible = 1")
      .bind(slug).first<{ slug: string; name: string; description: string }>();
    const config = (await getConfig(c.env)).config;
    const locale = docLocale(config);
    const fallbackDescription = row ? copy("categoryBrowse", locale, { name: row.name }) : "";
    if (!row) return serveDoc(c, { title: copy("categoryMissing", locale), description: copy("categoryMissingBody", locale), canonicalPath: `/c/${slug}`, status: 404, noindex: true });
    return serveDoc(c, {
      title: row.name,
      description: row.description || fallbackDescription,
      canonicalPath: `/c/${slug}`,
      status: 200,
      ogType: "website",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: row.name,
        description: row.description || fallbackDescription,
        url: `${config.site.url.replace(/\/$/, "")}/c/${row.slug}`,
        isPartOf: { "@type": "WebSite", name: config.site.name, url: config.site.url.replace(/\/$/, "") },
      },
    });
  });

  app.get("/tag/:slug", async (c) => {
    const slug = c.req.param("slug");
    const row = await c.env.DB.prepare("SELECT slug, name, description FROM tags WHERE slug = ? AND status = 'active'")
      .bind(slug).first<{ slug: string; name: string; description: string }>();
    const config = (await getConfig(c.env)).config;
    const locale = docLocale(config);
    const fallbackDescription = row ? copy("tagTopics", locale, { name: row.name }) : "";
    if (!row) return serveDoc(c, { title: copy("tagMissing", locale), description: copy("tagMissingBody", locale), canonicalPath: `/tag/${slug}`, status: 404, noindex: true });
    return serveDoc(c, {
      title: `#${row.name}`,
      description: row.description || fallbackDescription,
      canonicalPath: `/tag/${slug}`,
      status: 200,
      ogType: "website",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: `#${row.name}`,
        description: row.description || fallbackDescription,
        url: `${config.site.url.replace(/\/$/, "")}/tag/${row.slug}`,
        isPartOf: { "@type": "WebSite", name: config.site.name, url: config.site.url.replace(/\/$/, "") },
      },
    });
  });

  app.get("/u/:username", async (c) => {
    const username = c.req.param("username").toLowerCase();
    const row = await c.env.DB.prepare("SELECT username, name, bio FROM user WHERE username = ? AND status = 'active'")
      .bind(username).first<{ username: string; name: string; bio: string | null }>();
    const config = (await getConfig(c.env)).config;
    const locale = docLocale(config);
    if (!row) return serveDoc(c, { title: copy("userMissing", locale), description: copy("userMissingBody", locale), canonicalPath: `/u/${username}`, status: 404, noindex: true });
    return serveDoc(c, {
      title: row.name,
      description: row.bio || copy("userHome", locale, { username: row.username }),
      canonicalPath: `/u/${row.username}`,
      status: 200,
      ogType: "website",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "ProfilePage",
        mainEntity: { "@type": "Person", name: row.name, alternateName: `@${row.username}`, description: row.bio || undefined },
        url: `${config.site.url.replace(/\/$/, "")}/u/${row.username}`,
      },
    });
  });

  const spaFallback = async (c: Context<AppEnv>) => {
    const asset = await shell(c);
    return new Response(asset.body, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy": CSP,
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        "referrer-policy": "strict-origin-when-cross-origin",
        "permissions-policy": "camera=(), microphone=(), geolocation=()",
        "x-robots-tag": "noindex",
      },
    });
  };

  app.get("/sitemap.xml", async (c) => {
    const config = (await getConfig(c.env)).config;
    if (!config.seo.sitemapEnabled || config.seo.noindex) return c.notFound();
    const site = config.site.url.replace(/\/$/, "");
    const [topics, categories, tags] = await Promise.all([
      c.env.DB.prepare(
        `SELECT t.id, t.updated_at AS lastmod FROM topics t JOIN categories cat ON cat.id = t.category_id
          WHERE t.status = 'published' AND cat.is_visible = 1 ORDER BY t.updated_at DESC LIMIT 50000`,
      ).all<{ id: string; lastmod: number }>(),
      c.env.DB.prepare("SELECT slug FROM categories WHERE is_visible = 1 ORDER BY sort_order").all<{ slug: string }>(),
      c.env.DB.prepare("SELECT slug FROM tags WHERE status = 'active' ORDER BY name").all<{ slug: string }>(),
    ]);
    const homeLast = topics.results[0]?.lastmod
      ? `<lastmod>${new Date(Number(topics.results[0].lastmod) * 1000).toISOString()}</lastmod>`
      : "";
    const urls = [
      `<url><loc>${xmlEscape(site)}/</loc>${homeLast}</url>`,
      `<url><loc>${xmlEscape(`${site}/tags`)}</loc></url>`,
      ...categories.results.map((row) => `<url><loc>${xmlEscape(`${site}/c/${row.slug}`)}</loc></url>`),
      ...tags.results.map((row) => `<url><loc>${xmlEscape(`${site}/tag/${row.slug}`)}</loc></url>`),
      ...topics.results.map((row) => `<url><loc>${xmlEscape(`${site}/t/${row.id}`)}</loc><lastmod>${new Date(Number(row.lastmod) * 1000).toISOString()}</lastmod></url>`),
    ];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`;
    return c.body(xml, 200, { "content-type": "application/xml; charset=utf-8", "cache-control": "public, s-maxage=3600" });
  });

  app.get("/robots.txt", async (c) => {
    const config = (await getConfig(c.env)).config;
    const lines = config.seo.noindex
      ? ["User-agent: *", "Disallow: /"]
      : [
          "User-agent: *",
          "Allow: /",
          "Disallow: /api/",
          "Disallow: /search",
          "Disallow: /me",
          "Disallow: /notifications",
          "Disallow: /new",
          "Disallow: /login",
          "Disallow: /register",
          "Disallow: /reset-password",
          "Disallow: /verify-email",
          "Disallow: /unsubscribe",
          "Disallow: /admin",
          "Disallow: /mod",
          ...(config.seo.sitemapEnabled ? [`Sitemap: ${config.site.url.replace(/\/$/, "")}/sitemap.xml`] : []),
        ];
    return c.body(lines.join("\n") + "\n", 200, { "content-type": "text/plain; charset=utf-8", "cache-control": "public, s-maxage=3600" });
  });

  // SPA sub-routes under run_worker_first prefixes (edit/history/etc.).
  for (const prefix of ["/t/*", "/c/*", "/u/*", "/tag/*"]) {
    app.get(prefix, spaFallback);
  }

  app.get("/manifest.webmanifest", async (c) => {
    const [loaded, integration] = await Promise.all([getConfig(c.env), getEffectiveIntegrations(c.env)]);
    const config = loaded.config;
    const cdn = integration.cloudflare.cdnUrl.replace(/\/$/, "");
    const icon = config.site.logoKey ? `${cdn}/${config.site.logoKey}` : "/icon.svg";
    return c.json(
      {
        name: config.site.name,
        short_name: config.site.name.slice(0, 12),
        description: config.site.description || config.site.tagline,
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#f1f3f1",
        theme_color: "#14513f",
        lang: config.site.language,
        icons: [{ src: icon, sizes: "any", type: icon.endsWith(".svg") ? "image/svg+xml" : "image/png", purpose: "any" }],
      },
      200,
      { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "public, s-maxage=3600" },
    );
  });
}
