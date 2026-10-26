import { ulid, type AdminIntegrations, type IntegrationSecretName, type IntegrationSecretStatus } from "@pineboard/shared";
import { getConfig, readConfigVersion } from "./config";
import type { Bindings } from "./env";

const SECRET_PREFIX = "secrets.";
const CACHE_TTL_MS = 30_000;

const ENV_BINDING: Record<IntegrationSecretName, keyof Bindings> = {
  resendApiKey: "RESEND_API_KEY",
  resendWebhookSecret: "RESEND_WEBHOOK_SECRET",
  turnstileSecret: "TURNSTILE_SECRET",
  r2AccessKeyId: "R2_ACCESS_KEY_ID",
  r2SecretAccessKey: "R2_SECRET_ACCESS_KEY",
};

type SealedSecret = { v: 1; iv: string; ct: string };
type SecretRow = { key: string; value_json: string; updated_at: number };

type LoadedSecrets = {
  values: Partial<Record<IntegrationSecretName, string>>;
  statuses: Record<IntegrationSecretName, IntegrationSecretStatus>;
};

export type EffectiveIntegrations = {
  cloudflare: {
    accountId: string;
    r2Bucket: string;
    cdnUrl: string;
    turnstileSiteKey: string;
  };
  secrets: Record<IntegrationSecretName, string | null>;
  statuses: Record<IntegrationSecretName, IntegrationSecretStatus>;
};

let secretCache: (LoadedSecrets & { expiresAt: number }) | null = null;
let secretBurst: Promise<LoadedSecrets> | null = null;

export function clearIntegrationCache(): void {
  secretCache = null;
  secretBurst = null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function encryptionKey(env: Bindings): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${env.BETTER_AUTH_SECRET}:integration-secrets:v1`),
  );
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function sealSecret(env: Bindings, plaintext: string): Promise<string> {
  const key = await encryptionKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  const sealed: SealedSecret = { v: 1, iv: bytesToBase64(iv), ct: bytesToBase64(new Uint8Array(encrypted)) };
  return JSON.stringify(sealed);
}

async function openSecret(env: Bindings, raw: string): Promise<string | null> {
  try {
    const sealed = JSON.parse(raw) as Partial<SealedSecret>;
    if (sealed.v !== 1 || typeof sealed.iv !== "string" || typeof sealed.ct !== "string") return null;
    const key = await encryptionKey(env);
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(sealed.iv) },
      key,
      base64ToBytes(sealed.ct),
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}

function envValue(env: Bindings, name: IntegrationSecretName): string | null {
  const value = env[ENV_BINDING[name]];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function loadSecrets(env: Bindings): Promise<LoadedSecrets> {
  const result = await env.DB.prepare(
    "SELECT key, value_json, updated_at FROM settings WHERE group_name = 'secrets'",
  ).all<SecretRow>();
  const stored = new Map<string, { value: string | null; updatedAt: number }>();
  for (const row of result.results) {
    const name = row.key.startsWith(SECRET_PREFIX) ? row.key.slice(SECRET_PREFIX.length) : "";
    if (!(name in ENV_BINDING)) continue;
    stored.set(name, { value: await openSecret(env, row.value_json), updatedAt: Number(row.updated_at) });
  }
  const values: LoadedSecrets["values"] = {};
  const statuses = {} as Record<IntegrationSecretName, IntegrationSecretStatus>;
  for (const name of Object.keys(ENV_BINDING) as IntegrationSecretName[]) {
    const row = stored.get(name);
    const fallback = envValue(env, name);
    if (row?.value) {
      values[name] = row.value;
      statuses[name] = { configured: true, source: "database", updatedAt: row.updatedAt };
    } else if (fallback) {
      values[name] = fallback;
      statuses[name] = { configured: true, source: "environment", updatedAt: null };
    } else {
      statuses[name] = { configured: false, source: "missing", updatedAt: null };
    }
  }
  return { values, statuses };
}

async function getLoadedSecrets(env: Bindings): Promise<LoadedSecrets> {
  const now = Date.now();
  if (secretCache && secretCache.expiresAt > now) return secretCache;
  if (secretBurst) return secretBurst;
  secretBurst = loadSecrets(env)
    .then((loaded) => {
      secretCache = { ...loaded, expiresAt: Date.now() + CACHE_TTL_MS };
      return loaded;
    })
    .finally(() => {
      secretBurst = null;
    });
  return secretBurst;
}

/**
 * Database values win over Worker secrets so the admin UI can rotate keys
 * without a redeploy. Environment variables remain the fallback.
 */
export async function getEffectiveIntegrations(env: Bindings): Promise<EffectiveIntegrations> {
  const [loaded, secrets] = await Promise.all([getConfig(env), getLoadedSecrets(env)]);
  const cf = loaded.config.integration.cloudflare;
  return {
    cloudflare: {
      accountId: cf.accountId || env.R2_ACCOUNT_ID || "",
      r2Bucket: cf.r2Bucket || env.R2_BUCKET_NAME || "",
      cdnUrl: (cf.cdnUrl || env.CDN_URL || "").replace(/\/$/, ""),
      turnstileSiteKey: cf.turnstileSiteKey || env.TURNSTILE_SITE_KEY || "",
    },
    secrets: {
      resendApiKey: secrets.values.resendApiKey ?? null,
      resendWebhookSecret: secrets.values.resendWebhookSecret ?? null,
      turnstileSecret: secrets.values.turnstileSecret ?? null,
      r2AccessKeyId: secrets.values.r2AccessKeyId ?? null,
      r2SecretAccessKey: secrets.values.r2SecretAccessKey ?? null,
    },
    statuses: secrets.statuses,
  };
}

export async function getAdminIntegrations(env: Bindings): Promise<AdminIntegrations> {
  const [loaded, effective, version] = await Promise.all([
    getConfig(env),
    getEffectiveIntegrations(env),
    readConfigVersion(env),
  ]);
  return {
    version: String(version),
    config: loaded.config.integration,
    effective: { cloudflare: effective.cloudflare },
    secrets: effective.statuses,
  };
}

export async function writeIntegrationSecrets(
  env: Bindings,
  actorId: string,
  patch: Partial<Record<IntegrationSecretName, string | null>>,
): Promise<void> {
  const entries = Object.entries(patch).filter((entry): entry is [IntegrationSecretName, string | null] =>
    entry[0] in ENV_BINDING,
  );
  if (!entries.length) return;

  const versionRow = await env.DB.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM settings").first<{ version: number }>();
  const version = Number(versionRow?.version ?? 0) + 1;
  const now = Math.floor(Date.now() / 1000);
  const statements: D1PreparedStatement[] = [];
  const changed: string[] = [];

  for (const [name, value] of entries) {
    const key = `${SECRET_PREFIX}${name}`;
    if (!value) {
      statements.push(env.DB.prepare("DELETE FROM settings WHERE key = ?").bind(key));
      changed.push(`${key}:clear`);
      continue;
    }
    statements.push(
      env.DB.prepare(
        `INSERT INTO settings (key, value_json, group_name, updated_at, updated_by, version)
         VALUES (?, ?, 'secrets', ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value_json = excluded.value_json,
           group_name = excluded.group_name,
           updated_at = excluded.updated_at,
           updated_by = excluded.updated_by,
           version = excluded.version`,
      ).bind(key, await sealSecret(env, value), now, actorId, version),
    );
    changed.push(`${key}:set`);
  }

  statements.push(
    env.DB.prepare(
      `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, meta_json, ip_hash, created_at)
       VALUES (?, ?, 'integrations.secrets', 'settings', NULL, ?, NULL, ?)`,
    ).bind(ulid(), actorId, JSON.stringify({ keys: changed }), now),
  );

  await env.DB.batch(statements);
  clearIntegrationCache();
}
