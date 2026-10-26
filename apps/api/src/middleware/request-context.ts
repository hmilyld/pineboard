import type { Context, Next } from "hono";

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

export async function requestContext(c: Context, next: Next): Promise<void> {
  const requestId = c.req.header("cf-ray") ?? crypto.randomUUID();
  c.set("requestId", requestId);
  c.header("x-request-id", requestId);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) c.header(name, value);
  await next();
}
