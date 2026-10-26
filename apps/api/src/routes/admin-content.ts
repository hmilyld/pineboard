import {
  adminCategorySchema,
  adminTagSchema,
  categoryInputSchema,
  categoryModeratorInputSchema,
  fail,
  navItemInputSchema,
  ok,
  reorderSchema,
  tagInputSchema,
  ulid,
  type AdminCategory,
  type AdminTag,
  type CategoryModerator,
  type NavItem,
} from "@pineboard/shared";
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { requireAdmin } from "../middleware/guards";

type Row = Record<string, unknown>;

function zodFields(error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> }): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "form";
    (fields[key] ??= []).push(issue.message);
  }
  return fields;
}

function mapAdminCategory(row: Row, moderators: CategoryModerator[] = []): AdminCategory {
  return adminCategorySchema.parse({
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    description: String(row.description ?? ""),
    color: String(row.color ?? "#14513f"),
    sortOrder: Number(row.sort_order ?? 0),
    isVisible: Number(row.is_visible ?? 0) === 1,
    topicCount: Number(row.topic_count ?? 0),
    createdAt: Number(row.created_at ?? 0),
    moderators,
  });
}

async function loadModeratorMap(db: D1Database): Promise<Map<string, CategoryModerator[]>> {
  const rows = await db.prepare(
    `SELECT cm.category_id, u.id, u.username, u.name, u.role
       FROM category_moderators cm JOIN user u ON u.id = cm.user_id
      ORDER BY u.name, u.username`,
  ).all<Row>();
  const map = new Map<string, CategoryModerator[]>();
  for (const row of rows.results) {
    const categoryId = String(row.category_id);
    const list = map.get(categoryId) ?? [];
    list.push({
      id: String(row.id),
      username: (row.username as string | null) ?? null,
      name: String(row.name),
      role: row.role === "admin" ? "admin" : row.role === "moderator" ? "moderator" : "user",
    });
    map.set(categoryId, list);
  }
  return map;
}

async function demoteOrphanModerators(db: D1Database): Promise<void> {
  await db.prepare(
    `UPDATE user SET role = 'user', updated_at = unixepoch()
      WHERE role = 'moderator'
        AND id NOT IN (SELECT user_id FROM category_moderators)`,
  ).run();
}

function mapNav(row: Row): NavItem {
  return {
    id: String(row.id),
    label: String(row.label),
    href: String(row.href ?? ""),
    kind: row.kind === "categories" ? "categories" : row.kind === "dropdown" ? "dropdown" : "link",
    parentId: (row.parent_id as string | null) ?? null,
    sortOrder: Number(row.sort_order ?? 0),
    isVisible: Number(row.is_visible ?? 0) === 1,
    openInNewTab: Number(row.open_in_new_tab ?? 0) === 1,
  };
}


function mapAdminTag(row: Row): AdminTag {
  const status = row.status === "hidden" || row.status === "merged" ? row.status : "active";
  return adminTagSchema.parse({
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    description: String(row.description ?? ""),
    color: String(row.color ?? "#71717a"),
    usageCount: Number(row.usage_count ?? 0),
    status,
    topicCount: Number(row.topic_count ?? 0),
    createdAt: Number(row.created_at ?? 0),
  });
}

async function readJson(c: { req: { json(): Promise<unknown> } }): Promise<unknown | null> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

function auditStatement(
  db: D1Database,
  actorId: string,
  action: string,
  targetType: string,
  targetId: string,
  meta: unknown,
  now: number,
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, meta_json, ip_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
  ).bind(ulid(), actorId, action, targetType, targetId, JSON.stringify(meta), now);
}

export const adminContentRoutes = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const categorySelect = `SELECT c.id, c.slug, c.name, c.description, c.color, c.sort_order, c.is_visible, c.created_at,
  (SELECT COUNT(*) FROM topics t WHERE t.category_id = c.id AND t.status = 'published') AS topic_count
  FROM categories c`;

async function loadAdminCategories(db: D1Database): Promise<AdminCategory[]> {
  const [rows, moderators] = await Promise.all([
    db.prepare(`${categorySelect} ORDER BY c.sort_order, c.name`).all<Row>(),
    loadModeratorMap(db),
  ]);
  return rows.results.map((row) => mapAdminCategory(row, moderators.get(String(row.id)) ?? []));
}

adminContentRoutes.get("/api/admin/categories", requireAdmin, async (c) => {
  c.header("cache-control", "no-store");
  return c.json(ok(await loadAdminCategories(c.env.DB)));
});

adminContentRoutes.post("/api/admin/categories", requireAdmin, async (c) => {
  const body = await readJson(c);
  const parsed = categoryInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(fail("validation_error", "请检查版块信息", zodFields(parsed.error)), 400);
  }
  const input = parsed.data;
  const exists = await c.env.DB.prepare("SELECT 1 AS ok FROM categories WHERE slug = ?").bind(input.slug).first();
  if (exists) return c.json(fail("conflict", "该 slug 已被使用"), 409);

  const now = Math.floor(Date.now() / 1000);
  const id = ulid();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO categories (id, slug, name, description, color, sort_order, is_visible, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, input.slug, input.name, input.description, input.color, input.sortOrder, input.isVisible ? 1 : 0, now),
    auditStatement(c.env.DB, c.get("user")!.id, "category.create", "category", id, { slug: input.slug }, now),
  ]);
  c.header("cache-control", "no-store");
  return c.json(ok((await loadAdminCategories(c.env.DB)).find((item) => item.id === id)), 201);
});

adminContentRoutes.patch("/api/admin/categories/reorder", requireAdmin, async (c) => {
  const parsed = reorderSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(fail("validation_error", "排序参数不合法"), 400);
  const now = Math.floor(Date.now() / 1000);
  const statements = parsed.data.ids.map((id, index) =>
    c.env.DB.prepare("UPDATE categories SET sort_order = ? WHERE id = ?").bind(index * 10, id),
  );
  if (statements.length) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, meta_json, ip_hash, created_at)
         VALUES (?, ?, 'categories.reorder', 'categories', NULL, ?, NULL, ?)`,
      ).bind(ulid(), c.get("user")!.id, JSON.stringify({ ids: parsed.data.ids }), now),
    );
    await c.env.DB.batch(statements);
  }
  c.header("cache-control", "no-store");
  return c.json(ok(await loadAdminCategories(c.env.DB)));
});

adminContentRoutes.patch("/api/admin/categories/:id", requireAdmin, async (c) => {
  const id = c.req.param("id");
  const current = await c.env.DB.prepare("SELECT id FROM categories WHERE id = ?").bind(id).first();
  if (!current) return c.json(fail("not_found", "版块不存在"), 404);

  const parsed = categoryInputSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(fail("validation_error", "请检查版块信息", zodFields(parsed.error)), 400);
  const input = parsed.data;
  const exists = await c.env.DB.prepare("SELECT 1 AS ok FROM categories WHERE slug = ? AND id != ?")
    .bind(input.slug, id)
    .first();
  if (exists) return c.json(fail("conflict", "该 slug 已被使用"), 409);

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE categories SET slug = ?, name = ?, description = ?, color = ?, sort_order = ?, is_visible = ? WHERE id = ?`,
    ).bind(input.slug, input.name, input.description, input.color, input.sortOrder, input.isVisible ? 1 : 0, id),
    auditStatement(c.env.DB, c.get("user")!.id, "category.update", "category", id, { slug: input.slug, name: input.name }, Math.floor(Date.now() / 1000)),
  ]);
  c.header("cache-control", "no-store");
  return c.json(ok((await loadAdminCategories(c.env.DB)).find((item) => item.id === id)));
});

adminContentRoutes.delete("/api/admin/categories/:id", requireAdmin, async (c) => {
  const id = c.req.param("id");
  const current = await c.env.DB.prepare("SELECT id FROM categories WHERE id = ?").bind(id).first();
  if (!current) return c.json(fail("not_found", "版块不存在"), 404);
  const topics = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM topics WHERE category_id = ?").bind(id).first<{ n: number }>();
  if (Number(topics?.n ?? 0) > 0) {
    return c.json(fail("conflict", "该版块下仍有主题，请先移动或隐藏版块"), 409);
  }
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM categories WHERE id = ?").bind(id),
    auditStatement(c.env.DB, c.get("user")!.id, "category.delete", "category", id, null, Math.floor(Date.now() / 1000)),
  ]);
  await demoteOrphanModerators(c.env.DB);
  c.header("cache-control", "no-store");
  return c.json(ok({ deleted: true }));
});



adminContentRoutes.post("/api/admin/categories/:id/moderators", requireAdmin, async (c) => {
  const categoryId = c.req.param("id");
  const category = await c.env.DB.prepare("SELECT id FROM categories WHERE id = ?").bind(categoryId).first();
  if (!category) return c.json(fail("not_found", "版块不存在"), 404);
  const parsed = categoryModeratorInputSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(fail("validation_error", "请输入用户名或邮箱"), 400);
  const identifier = parsed.data.username;
  const target = await c.env.DB.prepare(
    `SELECT id, username, name, role, status FROM user
      WHERE status = 'active' AND (LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)) LIMIT 1`,
  ).bind(identifier, identifier).first<{ id: string; username: string | null; name: string; role: string }>();
  if (!target) return c.json(fail("not_found", "用户不存在或未激活"), 404);
  if (target.role === "admin") return c.json(fail("validation_error", "管理员已拥有全站权限，无需分配版块"), 400);

  const now = Math.floor(Date.now() / 1000);
  const statements = [
    c.env.DB.prepare("INSERT OR IGNORE INTO category_moderators (category_id, user_id) VALUES (?, ?)").bind(categoryId, target.id),
  ];
  if (target.role !== "moderator") {
    statements.push(
      c.env.DB.prepare("UPDATE user SET role = 'moderator', updated_at = ? WHERE id = ? AND role = 'user'").bind(now, target.id),
    );
  }
  statements.push(
    c.env.DB.prepare(
      `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, meta_json, ip_hash, created_at)
       VALUES (?, ?, 'category.moderator.add', 'category', ?, ?, NULL, ?)`,
    ).bind(ulid(), c.get("user")!.id, categoryId, JSON.stringify({ userId: target.id }), now),
  );
  await c.env.DB.batch(statements);
  c.header("cache-control", "no-store");
  return c.json(ok(await loadAdminCategories(c.env.DB)));
});

adminContentRoutes.delete("/api/admin/categories/:id/moderators/:userId", requireAdmin, async (c) => {
  const categoryId = c.req.param("id");
  const userId = c.req.param("userId");
  const mapping = await c.env.DB.prepare(
    "SELECT 1 AS ok FROM category_moderators WHERE category_id = ? AND user_id = ?",
  ).bind(categoryId, userId).first();
  if (!mapping) return c.json(fail("not_found", "该用户不是此版块版主"), 404);
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM category_moderators WHERE category_id = ? AND user_id = ?").bind(categoryId, userId),
    c.env.DB.prepare(
      `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, meta_json, ip_hash, created_at)
       VALUES (?, ?, 'category.moderator.remove', 'category', ?, ?, NULL, ?)`,
    ).bind(ulid(), c.get("user")!.id, categoryId, JSON.stringify({ userId }), now),
  ]);
  await demoteOrphanModerators(c.env.DB);
  c.header("cache-control", "no-store");
  return c.json(ok(await loadAdminCategories(c.env.DB)));
});

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

const tagSelect = `SELECT g.id, g.slug, g.name, g.description, g.color,
  (SELECT COUNT(*) FROM topic_tags tt JOIN topics t ON t.id = tt.topic_id
    WHERE tt.tag_id = g.id AND t.status = 'published') AS usage_count,
  g.status, g.created_at,
  (SELECT COUNT(*) FROM topic_tags tt JOIN topics t ON t.id = tt.topic_id
    WHERE tt.tag_id = g.id AND t.status = 'published') AS topic_count
  FROM tags g`;

async function loadAdminTags(db: D1Database): Promise<AdminTag[]> {
  const rows = await db.prepare(`${tagSelect} ORDER BY CASE g.status WHEN 'active' THEN 0 WHEN 'hidden' THEN 1 ELSE 2 END,
    (SELECT COUNT(*) FROM topic_tags tt JOIN topics t ON t.id = tt.topic_id
      WHERE tt.tag_id = g.id AND t.status = 'published') DESC, g.name`).all<Row>();
  return rows.results.map(mapAdminTag);
}

adminContentRoutes.get("/api/admin/tags", requireAdmin, async (c) => {
  c.header("cache-control", "no-store");
  return c.json(ok(await loadAdminTags(c.env.DB)));
});

adminContentRoutes.post("/api/admin/tags", requireAdmin, async (c) => {
  const parsed = tagInputSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(fail("validation_error", "请检查标签信息", zodFields(parsed.error)), 400);
  const input = parsed.data;
  const exists = await c.env.DB.prepare("SELECT 1 AS ok FROM tags WHERE slug = ?").bind(input.slug).first();
  if (exists) return c.json(fail("conflict", "该 slug 已被使用"), 409);
  const id = ulid();
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO tags (id, slug, name, description, color, usage_count, status, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    ).bind(id, input.slug, input.name, input.description, input.color, input.status, now),
    auditStatement(c.env.DB, c.get("user")!.id, "tag.create", "tag", id, { slug: input.slug }, now),
  ]);
  const row = await c.env.DB.prepare(`${tagSelect} WHERE g.id = ?`).bind(id).first<Row>();
  c.header("cache-control", "no-store");
  return c.json(ok(mapAdminTag(row ?? {})), 201);
});

adminContentRoutes.patch("/api/admin/tags/:id", requireAdmin, async (c) => {
  const id = c.req.param("id");
  const current = await c.env.DB.prepare("SELECT id FROM tags WHERE id = ?").bind(id).first();
  if (!current) return c.json(fail("not_found", "标签不存在"), 404);
  const parsed = tagInputSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(fail("validation_error", "请检查标签信息", zodFields(parsed.error)), 400);
  const input = parsed.data;
  const exists = await c.env.DB.prepare("SELECT 1 AS ok FROM tags WHERE slug = ? AND id != ?").bind(input.slug, id).first();
  if (exists) return c.json(fail("conflict", "该 slug 已被使用"), 409);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE tags SET slug = ?, name = ?, description = ?, color = ?, status = ? WHERE id = ?`,
    ).bind(input.slug, input.name, input.description, input.color, input.status, id),
    auditStatement(c.env.DB, c.get("user")!.id, "tag.update", "tag", id, { slug: input.slug, name: input.name }, Math.floor(Date.now() / 1000)),
  ]);
  const row = await c.env.DB.prepare(`${tagSelect} WHERE g.id = ?`).bind(id).first<Row>();
  c.header("cache-control", "no-store");
  return c.json(ok(mapAdminTag(row ?? {})));
});

adminContentRoutes.delete("/api/admin/tags/:id", requireAdmin, async (c) => {
  const id = c.req.param("id");
  const current = await c.env.DB.prepare("SELECT id FROM tags WHERE id = ?").bind(id).first();
  if (!current) return c.json(fail("not_found", "标签不存在"), 404);
  const used = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM topic_tags tt JOIN topics t ON t.id = tt.topic_id WHERE tt.tag_id = ? AND t.status = 'published'",
  ).bind(id).first<{ n: number }>();
  if (Number(used?.n ?? 0) > 0) {
    return c.json(fail("conflict", "该标签仍被主题使用，请先隐藏或移除引用"), 409);
  }
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM tags WHERE id = ?").bind(id),
    auditStatement(c.env.DB, c.get("user")!.id, "tag.delete", "tag", id, null, Math.floor(Date.now() / 1000)),
  ]);
  c.header("cache-control", "no-store");
  return c.json(ok({ deleted: true }));
});

// ---------------------------------------------------------------------------
// Top navigation
// ---------------------------------------------------------------------------

async function loadAdminNav(db: D1Database): Promise<NavItem[]> {
  const rows = await db.prepare(
    "SELECT id, label, href, kind, parent_id, sort_order, is_visible, open_in_new_tab FROM nav_items ORDER BY sort_order, id",
  ).all<Row>();
  return rows.results.map(mapNav);
}

adminContentRoutes.get("/api/admin/nav", requireAdmin, async (c) => {
  c.header("cache-control", "no-store");
  return c.json(ok(await loadAdminNav(c.env.DB)));
});

adminContentRoutes.post("/api/admin/nav", requireAdmin, async (c) => {
  const parsed = navItemInputSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(fail("validation_error", "请检查导航项", zodFields(parsed.error)), 400);
  const input = parsed.data;
  if (input.parentId) {
    const parent = await c.env.DB.prepare("SELECT id, kind FROM nav_items WHERE id = ?").bind(input.parentId).first<{ id: string; kind: string }>();
    if (!parent || parent.kind !== "dropdown") return c.json(fail("validation_error", "父项必须是下拉菜单"), 400);
    if (input.kind !== "link") return c.json(fail("validation_error", "子项必须是链接"), 400);
  }
  const id = ulid();
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO nav_items (id, label, href, kind, parent_id, sort_order, is_visible, open_in_new_tab, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, input.label, input.kind === "categories" ? "" : input.href, input.kind, input.parentId ?? null, input.sortOrder, input.isVisible ? 1 : 0, input.openInNewTab ? 1 : 0, now, now),
    auditStatement(c.env.DB, c.get("user")!.id, "nav.create", "nav", id, { label: input.label }, now),
  ]);
  const row = await c.env.DB.prepare(
    "SELECT id, label, href, kind, parent_id, sort_order, is_visible, open_in_new_tab FROM nav_items WHERE id = ?",
  ).bind(id).first<Row>();
  c.header("cache-control", "no-store");
  return c.json(ok(mapNav(row ?? {})), 201);
});

adminContentRoutes.patch("/api/admin/nav/reorder", requireAdmin, async (c) => {
  const parsed = reorderSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(fail("validation_error", "排序参数不合法"), 400);
  const statements = parsed.data.ids.map((id, index) =>
    c.env.DB.prepare("UPDATE nav_items SET sort_order = ?, updated_at = unixepoch() WHERE id = ?").bind(index * 10, id),
  );
  if (statements.length) {
    statements.push(auditStatement(c.env.DB, c.get("user")!.id, "nav.reorder", "nav", "list", { ids: parsed.data.ids }, Math.floor(Date.now() / 1000)));
    await c.env.DB.batch(statements);
  }
  c.header("cache-control", "no-store");
  return c.json(ok(await loadAdminNav(c.env.DB)));
});

adminContentRoutes.patch("/api/admin/nav/:id", requireAdmin, async (c) => {
  const id = c.req.param("id");
  const current = await c.env.DB.prepare("SELECT id FROM nav_items WHERE id = ?").bind(id).first();
  if (!current) return c.json(fail("not_found", "导航项不存在"), 404);
  const parsed = navItemInputSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(fail("validation_error", "请检查导航项", zodFields(parsed.error)), 400);
  const input = parsed.data;
  if (input.parentId) {
    if (input.parentId === id) return c.json(fail("validation_error", "不能将自己设为父项"), 400);
    const parent = await c.env.DB.prepare("SELECT id, kind FROM nav_items WHERE id = ?").bind(input.parentId).first<{ id: string; kind: string }>();
    if (!parent || parent.kind !== "dropdown") return c.json(fail("validation_error", "父项必须是下拉菜单"), 400);
    if (input.kind !== "link") return c.json(fail("validation_error", "子项必须是链接"), 400);
  }
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE nav_items SET label = ?, href = ?, kind = ?, parent_id = ?, sort_order = ?, is_visible = ?, open_in_new_tab = ?, updated_at = unixepoch()
        WHERE id = ?`,
    ).bind(input.label, input.kind === "categories" ? "" : input.href, input.kind, input.parentId ?? null, input.sortOrder, input.isVisible ? 1 : 0, input.openInNewTab ? 1 : 0, id),
    auditStatement(c.env.DB, c.get("user")!.id, "nav.update", "nav", id, { label: input.label }, Math.floor(Date.now() / 1000)),
  ]);
  const row = await c.env.DB.prepare(
    "SELECT id, label, href, kind, parent_id, sort_order, is_visible, open_in_new_tab FROM nav_items WHERE id = ?",
  ).bind(id).first<Row>();
  c.header("cache-control", "no-store");
  return c.json(ok(mapNav(row ?? {})));
});

adminContentRoutes.delete("/api/admin/nav/:id", requireAdmin, async (c) => {
  const id = c.req.param("id");
  const current = await c.env.DB.prepare("SELECT id FROM nav_items WHERE id = ?").bind(id).first();
  if (!current) return c.json(fail("not_found", "导航项不存在"), 404);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM nav_items WHERE parent_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM nav_items WHERE id = ?").bind(id),
    auditStatement(c.env.DB, c.get("user")!.id, "nav.delete", "nav", id, null, Math.floor(Date.now() / 1000)),
  ]);
  c.header("cache-control", "no-store");
  return c.json(ok({ deleted: true }));
});
