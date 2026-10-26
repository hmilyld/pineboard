import {
  UPLOAD_ARCHIVE_EXT,
  UPLOAD_ARCHIVE_MIME,
  UPLOAD_IMAGE_EXT,
  UPLOAD_IMAGE_MIME,
  fail,
  ok,
  uploadCompleteSchema,
  uploadSignSchema,
  type UploadKind,
  type UploadResult,
} from "@pineboard/shared";
import { Hono } from "hono";
import { getSecurityConfig } from "./config";
import type { AppEnv } from "./env";
import { getEffectiveIntegrations } from "./integrations";
import { requireAuth, requireVerified } from "./middleware/guards";
import { consumeRateLimit } from "./security";

const encoder = new TextEncoder();
const IMAGE_MIME = new Set<string>(UPLOAD_IMAGE_MIME);
const ARCHIVE_MIME = new Set<string>(UPLOAD_ARCHIVE_MIME);
const EXT_IMAGE: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};
const EXT_ARCHIVE: Record<string, string> = {
  zip: "application/zip",
  rar: "application/vnd.rar",
  "7z": "application/x-7z-compressed",
};

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function hmac(key: BufferSource, value: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value));
}

async function signingKey(secret: string, date: string): Promise<ArrayBuffer> {
  let current = await hmac(encoder.encode(`AWS4${secret}`), date);
  current = await hmac(current, "auto");
  current = await hmac(current, "s3");
  return hmac(current, "aws4_request");
}

function encodePath(key: string): string {
  return key.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

/** Presigned S3 PUT; signs `content-type` so R2 stores the MIME we approved. */
async function presignPut(input: {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  key: string;
  contentType: string;
  size: number;
}): Promise<{ url: string; expiresIn: number }> {
  const host = `${input.accountId}.r2.cloudflarestorage.com`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const expiresIn = 600;
  const canonicalUri = `/${input.bucket}/${encodePath(input.key)}`;
  const query = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${input.accessKeyId}/${dateStamp}/auto/s3/aws4_request`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(expiresIn)],
    ["X-Amz-SignedHeaders", "content-length;content-type;host"],
  ]
    .map(([key, value]) => `${encodeURIComponent(key!)}=${encodeURIComponent(value!)}`)
    .join("&");
  const canonicalHeaders = `content-length:${input.size}\ncontent-type:${input.contentType}\nhost:${host}\n`;
  const canonicalRequest = [
    "PUT",
    canonicalUri,
    query,
    canonicalHeaders,
    "content-length;content-type;host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256Hex(canonicalRequest)].join("\n");
  const signature = toHex(await hmac(await signingKey(input.secretAccessKey, dateStamp), stringToSign));
  return {
    url: `https://${host}${canonicalUri}?${query}&X-Amz-Signature=${signature}`,
    expiresIn,
  };
}

function extensionOf(filename: string): string {
  const parts = filename.toLowerCase().split(".");
  return parts.length > 1 ? parts.at(-1) ?? "" : "";
}

/**
 * Resolve the approved extension/content type. Never trust an SVG/HTML MIME;
 * unknown values fall back to the filename extension, then are rejected.
 */
function resolveMeta(kind: UploadKind, rawType: string, filename: string): { ext: string; contentType: string } | null {
  const type = rawType.split(";")[0]!.trim().toLowerCase();
  if (kind === "image") {
    const contentType = type === "image/jpg" ? "image/jpeg" : type;
    const ext = UPLOAD_IMAGE_EXT[contentType];
    if (ext && IMAGE_MIME.has(contentType)) return { ext, contentType };
    const byExt = EXT_IMAGE[extensionOf(filename)];
    if (byExt) return { ext: UPLOAD_IMAGE_EXT[byExt]!, contentType: byExt };
    return null;
  }
  const ext = UPLOAD_ARCHIVE_EXT[type];
  if (ext && ARCHIVE_MIME.has(type)) return { ext, contentType: type };
  const byExt = EXT_ARCHIVE[extensionOf(filename)];
  if (!byExt) return null;
  const canonicalExt = UPLOAD_ARCHIVE_EXT[byExt] ?? extensionOf(filename);
  return { ext: canonicalExt, contentType: byExt };
}

function maxBytesFor(kind: UploadKind, imageMaxMb: number, fileMaxMb: number): number {
  return (kind === "image" ? imageMaxMb : fileMaxMb) * 1024 * 1024;
}

function objectKey(userId: string, kind: UploadKind, ext: string): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const random = crypto.getRandomValues(new Uint8Array(16));
  const id = [...random].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `uploads/${userId}/${kind}/${yyyy}${mm}/${id}.${ext}`;
}

async function publicUrl(env: AppEnv["Bindings"], key: string): Promise<string> {
  const integration = await getEffectiveIntegrations(env);
  if (env.ENVIRONMENT === "development" || !integration.cloudflare.cdnUrl) return `/files/${encodePath(key)}`;
  return `${integration.cloudflare.cdnUrl}/${encodePath(key)}`;
}

function magicMatches(kind: UploadKind, ext: string, bytes: Uint8Array): boolean {
  const starts = (signature: number[]): boolean => signature.every((value, index) => bytes[index] === value);
  if (kind === "image") {
    if (ext === "jpg") return starts([0xff, 0xd8, 0xff]);
    if (ext === "png") return starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (ext === "gif") return starts([0x47, 0x49, 0x46, 0x38]);
    if (ext === "webp") return starts([0x52, 0x49, 0x46, 0x46]) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
    if (ext === "avif") return starts([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70]) || (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70);
    return false;
  }
  if (ext === "zip") return starts([0x50, 0x4b, 0x03, 0x04]) || starts([0x50, 0x4b, 0x05, 0x06]) || starts([0x50, 0x4b, 0x07, 0x08]);
  if (ext === "rar") return starts([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]);
  if (ext === "7z") return starts([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]);
  return false;
}

async function readJson(c: { req: { json(): Promise<unknown> } }): Promise<unknown | null> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

async function uploadAllowed(c: { env: AppEnv["Bindings"] }): Promise<{ enabled: boolean; imageMaxMb: number; fileMaxMb: number; userDailyCount: number }> {
  const config = (await getSecurityConfig(c.env)).config;
  return {
    enabled: config.feature.uploads,
    imageMaxMb: config.upload.imageMaxMb,
    fileMaxMb: config.upload.fileMaxMb,
    userDailyCount: config.upload.userDailyCount,
  };
}

async function rateLimited(c: { env: AppEnv["Bindings"] }, userId: string, daily: number): Promise<boolean> {
  const limit = await consumeRateLimit(c.env, `upload:${userId}`, 86_400, daily);
  return !limit.allowed;
}

async function resultFor(env: AppEnv["Bindings"], key: string, size: number, contentType: string): Promise<UploadResult> {
  return { key, url: await publicUrl(env, key), size, contentType };
}

export const uploadRoutes = new Hono<AppEnv>();

uploadRoutes.post("/api/uploads/sign", requireAuth, requireVerified, async (c) => {
  const allowed = await uploadAllowed(c);
  if (!allowed.enabled) return c.json(fail("forbidden", "上传功能已关闭"), 403);
  const user = c.get("user")!;
  if (await rateLimited(c, user.id, allowed.userDailyCount)) {
    return c.json(fail("rate_limited", "今日上传次数已达上限"), 429);
  }
  const parsed = uploadSignSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(fail("validation_error", "请检查上传参数"), 400);
  const { kind, filename, contentType, size } = parsed.data;
  const maxBytes = maxBytesFor(kind, allowed.imageMaxMb, allowed.fileMaxMb);
  if (size > maxBytes) return c.json(fail("validation_error", `文件不能超过 ${kind === "image" ? allowed.imageMaxMb : allowed.fileMaxMb}MB`), 400);
  const meta = resolveMeta(kind, contentType, filename);
  if (!meta) return c.json(fail("validation_error", kind === "image" ? "仅支持 JPG/PNG/WebP/GIF/AVIF 图片" : "附件仅支持 ZIP/RAR/7Z 压缩包"), 400);

  const integration = await getEffectiveIntegrations(c.env);
  const cf = integration.cloudflare;
  const accessKeyId = integration.secrets.r2AccessKeyId;
  const secretAccessKey = integration.secrets.r2SecretAccessKey;
  if (!cf.accountId || !cf.r2Bucket || !accessKeyId || !secretAccessKey) {
    return c.json(fail("internal_error", "上传服务未配置：请在后台填写 R2 Account ID、Bucket、Access Key 与 Secret Key"), 503);
  }
  const key = objectKey(user.id, kind, meta.ext);
  const signed = await presignPut({
    accountId: cf.accountId,
    bucket: cf.r2Bucket,
    accessKeyId,
    secretAccessKey,
    key,
    contentType: meta.contentType,
    size,
  });
  c.header("cache-control", "no-store");
  return c.json(ok({ key, uploadUrl: signed.url, expiresIn: signed.expiresIn, contentType: meta.contentType, maxBytes }));
});

uploadRoutes.post("/api/uploads/complete", requireAuth, requireVerified, async (c) => {
  const allowed = await uploadAllowed(c);
  if (!allowed.enabled) return c.json(fail("forbidden", "上传功能已关闭"), 403);
  const user = c.get("user")!;
  const parsed = uploadCompleteSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(fail("validation_error", "请检查上传参数"), 400);
  const { key, kind, size, contentType } = parsed.data;
  if (!key.startsWith(`uploads/${user.id}/`)) return c.json(fail("forbidden", "无权访问该文件"), 403);
  const meta = resolveMeta(kind, contentType, key);
  if (!meta) return c.json(fail("validation_error", "文件类型不合法"), 400);
  const maxBytes = maxBytesFor(kind, allowed.imageMaxMb, allowed.fileMaxMb);
  if (size > maxBytes) return c.json(fail("validation_error", "文件超过大小限制"), 400);
  const object = await c.env.BUCKET.head(key);
  if (!object) return c.json(fail("not_found", "文件尚未上传完成"), 404);
  if (object.size !== size) return c.json(fail("validation_error", "文件大小校验失败"), 400);
  const storedType = object.httpMetadata?.contentType?.toLowerCase();
  if (!storedType || storedType !== meta.contentType.toLowerCase()) {
    return c.json(fail("validation_error", "文件类型校验失败"), 400);
  }
  c.header("cache-control", "no-store");
  return c.json(ok(await resultFor(c.env, key, object.size, meta.contentType)));
});

/**
 * Worker direct fallback for local development / buckets without S3 CORS.
 * Validates magic bytes because this path bypasses the presigned content-type control.
 */
uploadRoutes.post("/api/uploads/direct", requireAuth, requireVerified, async (c) => {
  const allowed = await uploadAllowed(c);
  if (!allowed.enabled) return c.json(fail("forbidden", "上传功能已关闭"), 403);
  const user = c.get("user")!;
  if (await rateLimited(c, user.id, allowed.userDailyCount)) {
    return c.json(fail("rate_limited", "今日上传次数已达上限"), 429);
  }
  const kind = c.req.header("x-upload-kind") === "attachment" ? "attachment" : c.req.header("x-upload-kind") === "image" ? "image" : null;
  if (!kind) return c.json(fail("validation_error", "缺少上传类型"), 400);
  let filename = "file";
  try {
    filename = decodeURIComponent(c.req.header("x-file-name") ?? "file");
  } catch {
    filename = "file";
  }
  const contentType = c.req.header("content-type") ?? "application/octet-stream";
  const meta = resolveMeta(kind, contentType, filename);
  if (!meta) return c.json(fail("validation_error", kind === "image" ? "仅支持 JPG/PNG/WebP/GIF/AVIF 图片" : "附件仅支持 ZIP/RAR/7Z 压缩包"), 400);
  const maxBytes = maxBytesFor(kind, allowed.imageMaxMb, allowed.fileMaxMb);
  const directMax = Math.min(maxBytes, 25 * 1024 * 1024);
  const declared = Number(c.req.header("content-length") ?? 0);
  if (declared && declared > directMax) return c.json(fail("validation_error", "文件超过直传上限"), 413);
  const stream = c.req.raw.body;
  if (!stream) return c.json(fail("validation_error", "文件为空"), 400);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > directMax) {
        await reader.cancel();
        return c.json(fail("validation_error", "文件超过直传上限"), 413);
      }
      chunks.push(value);
    }
  } catch {
    return c.json(fail("validation_error", "文件读取失败"), 400);
  }
  if (total === 0) return c.json(fail("validation_error", "文件为空"), 400);
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (!magicMatches(kind, meta.ext, new Uint8Array(body.slice(0, 16)))) {
    return c.json(fail("validation_error", "文件内容与类型不匹配"), 400);
  }
  const key = objectKey(user.id, kind, meta.ext);
  await c.env.BUCKET.put(key, body, { httpMetadata: { contentType: meta.contentType } });
  const object = await c.env.BUCKET.head(key);
  if (!object) return c.json(fail("internal_error", "文件保存失败"), 500);
  c.header("cache-control", "no-store");
  return c.json(ok(await resultFor(c.env, key, object.size, meta.contentType)), 201);
});

/** Local/CDN fallback: serve uploaded objects through the Worker when no public CDN is used. */
uploadRoutes.get("/files/*", async (c) => {
  const key = c.req.path.replace(/^\/files\//, "");
  if (!key || key.includes("..")) return c.notFound();
  const object = await c.env.BUCKET.get(key);
  if (!object) return c.notFound();
  const contentType = object.httpMetadata?.contentType ?? "application/octet-stream";
  const headers = new Headers({
    "content-type": contentType,
    "content-length": String(object.size),
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
    "etag": object.httpEtag,
  });
  if (!contentType.startsWith("image/")) headers.set("content-disposition", "attachment");
  return new Response(object.body, { headers });
});


/** Delete unreferenced uploads older than the configured TTL. */
export async function cleanupOrphanUploads(env: AppEnv["Bindings"], ttlHours: number): Promise<number> {
  const cutoff = Date.now() - ttlHours * 3_600_000;
  const keyPattern = /uploads\/[A-Za-z0-9]+\/(?:image|attachment)\/\d{6}\/[a-f0-9]+\.[a-z0-9]+/g;
  const referenced = new Set<string>();
  const [posts, revisions, avatars, settings] = await Promise.all([
    env.DB.prepare("SELECT content_md AS value FROM posts WHERE content_md LIKE '%uploads/%'").all<{ value: string }>(),
    env.DB.prepare("SELECT content_md AS value FROM post_revisions WHERE content_md LIKE '%uploads/%'").all<{ value: string }>(),
    env.DB.prepare("SELECT avatar_key AS value FROM user WHERE avatar_key LIKE 'uploads/%'").all<{ value: string | null }>(),
    env.DB.prepare("SELECT value_json AS value FROM settings WHERE value_json LIKE '%uploads/%'").all<{ value: string }>(),
  ]);
  for (const row of [...posts.results, ...revisions.results, ...settings.results]) {
    for (const match of String(row.value ?? "").matchAll(keyPattern)) referenced.add(match[0]);
  }
  for (const row of avatars.results) if (row.value) referenced.add(row.value);

  let cursor: string | undefined;
  let removed = 0;
  do {
    const page = await env.BUCKET.list({ prefix: "uploads/", limit: 500, ...(cursor ? { cursor } : {}) });
    for (const object of page.objects) {
      if (removed >= 200) return removed;
      if (object.uploaded.getTime() >= cutoff || referenced.has(object.key)) continue;
      await env.BUCKET.delete(object.key);
      removed++;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor && removed < 200);
  return removed;
}
