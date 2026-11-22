import { ok, toPublicConfig, type NavItem } from "@pineboard/shared";
import { Hono } from "hono";
import { CACHE_TTL, cachedJson } from "../cache";
import { getConfig, getSecurityConfig } from "../config";
import type { AppEnv } from "../env";
import { getEffectiveIntegrations } from "../integrations";
import { siteStats } from "../stats";

export const siteRoutes = new Hono<AppEnv>();

// Footer counters do not need to be exact: one D1 pass every five minutes
// instead of one per visitor. `/api/topics` is the expensive page; this keeps
// its baseline free.
siteRoutes.get("/api/site/stats", async (c) =>
  cachedJson(c, CACHE_TTL.stats, async () => {
    const loaded = await getConfig(c.env);
    return ok(await siteStats(c.env.DB, loaded.config.site.timezone));
  }),
);

siteRoutes.get("/api/site", async (c) =>
  cachedJson(c, CACHE_TTL.config, async () => {
    const [loaded, integration] = await Promise.all([getSecurityConfig(c.env), getEffectiveIntegrations(c.env)]);
    return ok(toPublicConfig(loaded.config, loaded.version, integration.cloudflare.turnstileSiteKey));
  }),
);

/** Top navigation is a small, frequently edited table; never edge-cached. */
siteRoutes.get("/api/nav", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, label, href, kind, parent_id, sort_order, is_visible, open_in_new_tab
       FROM nav_items WHERE is_visible = 1 ORDER BY sort_order, id`,
  ).all<Record<string, unknown>>();
  const mapped: NavItem[] = rows.results.map((row) => ({
    id: String(row.id),
    label: String(row.label),
    href: String(row.href ?? ""),
    kind: row.kind === "categories" ? "categories" : row.kind === "dropdown" ? "dropdown" : "link",
    parentId: (row.parent_id as string | null) ?? null,
    sortOrder: Number(row.sort_order ?? 0),
    isVisible: Number(row.is_visible ?? 0) === 1,
    openInNewTab: Number(row.open_in_new_tab ?? 0) === 1,
  }));
  const data = mapped
    .filter((item) => !item.parentId)
    .map((item) => ({ ...item, children: mapped.filter((child) => child.parentId === item.id) }));
  c.header("cache-control", "no-store");
  return c.json(ok(data));
});
