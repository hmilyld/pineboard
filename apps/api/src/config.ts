import {
  configSchema,
  flattenConfigPatch,
  mergeDeep,
  parseConfigOverrides,
  ulid,
  type AppConfig,
  type ConfigGroup,
  type DeepPartial,
} from "@pineboard/shared";
import type { Bindings } from "./env";

type SettingsRow = { key: string; value_json: string; group_name: string; version: number };
type Loaded = { config: AppConfig; version: number; errors: { group: ConfigGroup; message: string }[] };

const FULL_TTL_MS = 45_000;
const SECURITY_TTL_MS = 5_000;
const SECURITY_GROUPS: ConfigGroup[] = ["maintenance", "account", "feature", "seo", "security"];

let fullCache: (Loaded & { expiresAt: number }) | null = null;
let securityCache: (Loaded & { expiresAt: number }) | null = null;
let burst: Promise<Loaded> | null = null;

export function clearConfigCache(): void {
  fullCache = null;
  securityCache = null;
  burst = null;
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  if (parts.some((part) => part === "__proto__" || part === "constructor" || part === "prototype")) return;
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    const next = cursor[part];
    if (typeof next !== "object" || next === null || Array.isArray(next)) cursor[part] = {};
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]!] = value;
}

function rowsToRaw(rows: SettingsRow[]): { raw: Record<string, unknown>; parseErrors: string[] } {
  const raw: Record<string, unknown> = {};
  const parseErrors: string[] = [];
  for (const row of rows) {
    try {
      setPath(raw, row.key, JSON.parse(row.value_json));
    } catch {
      parseErrors.push(`invalid JSON for ${row.key}`);
    }
  }
  return { raw, parseErrors };
}

async function load(env: Bindings, groups?: ConfigGroup[]): Promise<Loaded> {
  const db = env.DB;
  const params = groups?.length ? groups : undefined;
  const where = params ? `WHERE group_name IN (${params.map(() => "?").join(",")})` : "";
  const [rowsResult, versionResult] = await db.batch([
    db.prepare(`SELECT key, value_json, group_name, version FROM settings ${where}`).bind(...(params ?? [])),
    db.prepare(
      `SELECT COALESCE(
         (SELECT version FROM settings WHERE key = '__config_version'),
         (SELECT COALESCE(MAX(version), 0) FROM settings),
         0
       ) AS version`,
    ),
  ]);
  const rows = (rowsResult?.results ?? []) as unknown as SettingsRow[];
  const version = Number((versionResult?.results[0] as { version?: number } | undefined)?.version ?? 0);
  const { raw, parseErrors } = rowsToRaw(rows);
  const parsed = parseConfigOverrides(raw);
  if (parseErrors.length) {
    parsed.errors.push({ group: "site", message: parseErrors.join("; ") });
  }
  return { config: parsed.config, version, errors: parsed.errors };
}

/** Merged settings, cached per isolate for 45s (docs/01). */
export async function getConfig(env: Bindings): Promise<Loaded> {
  const now = Date.now();
  if (fullCache && fullCache.expiresAt > now) return fullCache;
  if (burst) return burst;
  burst = load(env)
    .then((result) => {
      fullCache = { ...result, expiresAt: Date.now() + FULL_TTL_MS };
      return result;
    })
    .finally(() => {
      burst = null;
    });
  return burst;
}

/**
 * Security-sensitive groups use a 5s cache. Other groups come from the 45s
 * snapshot; if it is stale we load it first to avoid mixing very old values.
 */
export async function getSecurityConfig(env: Bindings): Promise<Loaded> {
  const now = Date.now();
  if (securityCache && securityCache.expiresAt > now) return securityCache;
  const full = await getConfig(env);
  const fresh = await load(env, SECURITY_GROUPS);
  const config = structuredClone(full.config);
  for (const group of SECURITY_GROUPS) {
    (config as Record<ConfigGroup, unknown>)[group] = fresh.config[group];
  }
  const result: Loaded = {
    config,
    version: Math.max(full.version, fresh.version),
    errors: [...full.errors, ...fresh.errors],
  };
  securityCache = { ...result, expiresAt: Date.now() + SECURITY_TTL_MS };
  return result;
}

export async function getConfigVersion(env: Bindings): Promise<number> {
  return (await getConfig(env)).version;
}

export async function readConfigVersion(env: Bindings): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COALESCE(
       (SELECT version FROM settings WHERE key = '__config_version'),
       (SELECT COALESCE(MAX(version), 0) FROM settings),
       0
     ) AS version`,
  ).first<{ version: number }>();
  return Number(row?.version ?? 0);
}

export async function writeConfigPatch(
  env: Bindings,
  patch: DeepPartial<AppConfig>,
  actorId: string,
  expectedVersion?: number,
): Promise<Loaded> {
  const current = await getConfig(env);
  const expected = expectedVersion ?? current.version;
  const now = Math.floor(Date.now() / 1000);
  const merged = mergeDeep(current.config, patch);
  const parsed = configSchema.safeParse(merged);
  if (!parsed.success) {
    const error = new Error(
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
    );
    error.name = "ConfigValidationError";
    throw error;
  }
  const leaves = flattenConfigPatch(patch);
  const hasPath = (source: unknown, path: string): boolean => {
    let cursor: unknown = source;
    for (const part of path.split(".")) {
      if (typeof cursor !== "object" || cursor === null || !(part in cursor)) return false;
      cursor = (cursor as Record<string, unknown>)[part];
    }
    return true;
  };
  for (const leaf of leaves) {
    if (!hasPath(current.config, leaf.path) && !leaf.path.startsWith("theme.tokens.")) {
      const error = new Error(`unknown setting: ${leaf.path}`);
      error.name = "ConfigValidationError";
      throw error;
    }
  }
  if (leaves.length === 0) return current;

  let bumped = await env.DB.prepare(
    "UPDATE settings SET version = version + 1, updated_at = ? WHERE key = '__config_version' AND version = ?",
  ).bind(now, expected).run();
  if (Number(bumped.meta.changes ?? 0) === 0) {
    const exists = await env.DB.prepare("SELECT 1 AS ok FROM settings WHERE key = '__config_version'").first();
    if (!exists) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO settings (key, value_json, group_name, updated_at, version)
         VALUES ('__config_version', '{}', 'meta', ?, ?)`,
      ).bind(now, expected).run();
      bumped = await env.DB.prepare(
        "UPDATE settings SET version = version + 1, updated_at = ? WHERE key = '__config_version' AND version = ?",
      ).bind(now, expected).run();
    }
  }
  if (Number(bumped.meta.changes ?? 0) === 0) {
    const error = new Error("configuration changed");
    error.name = "ConfigVersionConflict";
    throw error;
  }
  const nextVersion = expected + 1;

  const statements: D1PreparedStatement[] = [];
  for (const leaf of leaves) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO settings (key, value_json, group_name, updated_at, updated_by, version)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value_json = excluded.value_json,
           group_name = excluded.group_name,
           updated_at = excluded.updated_at,
           updated_by = excluded.updated_by,
           version = excluded.version`,
      ).bind(leaf.path, JSON.stringify(leaf.value), leaf.group, now, actorId, nextVersion),
    );
  }
  statements.push(
    env.DB.prepare(
      `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, meta_json, ip_hash, created_at)
       VALUES (?, ?, 'settings.update', 'settings', NULL, ?, NULL, ?)`,
    ).bind(ulid(), actorId, JSON.stringify({ keys: leaves.map((leaf) => leaf.path) }), now),
  );
  await env.DB.batch(statements);
  clearConfigCache();
  return { config: parsed.data, version: nextVersion, errors: [] };
}
