import { ok, toPublicConfig, type NavItem } from "@pineboard/shared";
import { Hono } from "hono";
import { getConfig, getSecurityConfig } from "../config";
import type { AppEnv } from "../env";
import { getEffectiveIntegrations } from "../integrations";
import { siteStats } from "../stats";

export const siteRoutes = new Hono<AppEnv>();

siteRoutes.get("/api/site/stats", async (c) => {
  const loaded = await getConfig(c.env);
  const data = await siteStats(c.env.DB, loaded.config.site.timezone);
  c.header("cache-control", "public, s-maxage=60, stale-while-revalidate=30");
  return c.json(ok(data));
});

siteRoutes.get("/api/site", async (c) => {
  const [loaded, integration] = await Promise.all([getSecurityConfig(c.env), getEffectiveIntegrations(c.env)]);
  const data = toPublicConfig(loaded.config, loaded.version, integration.cloudflare.turnstileSiteKey);
  c.header("cache-control", "public, s-maxage=60, stale-while-revalidate=30");
  return c.json(ok(data));
});

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
