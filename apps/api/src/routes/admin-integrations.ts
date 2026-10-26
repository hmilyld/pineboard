import {
  adminIntegrationsPatchSchema,
  fail,
  ok,
  type AppConfig,
  type DeepPartial,
} from "@pineboard/shared";
import { Hono } from "hono";
import { writeConfigPatch } from "../config";
import type { AppEnv } from "../env";
import {
  getAdminIntegrations,
  getEffectiveIntegrations,
  writeIntegrationSecrets,
} from "../integrations";
import { requireAdmin } from "../middleware/guards";

async function readJson(c: { req: { json(): Promise<unknown> } }): Promise<unknown | null> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

export const adminIntegrationRoutes = new Hono<AppEnv>();

adminIntegrationRoutes.get("/api/admin/integrations", requireAdmin, async (c) => {
  c.header("cache-control", "no-store");
  return c.json(ok(await getAdminIntegrations(c.env)));
});

adminIntegrationRoutes.patch("/api/admin/integrations", requireAdmin, async (c) => {
  const parsed = adminIntegrationsPatchSchema.safeParse(await readJson(c));
  if (!parsed.success) {
    return c.json(fail("validation_error", "请检查集成配置"), 400);
  }
  const user = c.get("user")!;
  c.header("cache-control", "no-store");
  try {
    if (parsed.data.integration) {
      if (parsed.data.version === undefined) {
        return c.json(fail("validation_error", "缺少配置版本号 version"), 400);
      }
      await writeConfigPatch(
        c.env,
        { integration: parsed.data.integration } as DeepPartial<AppConfig>,
        user.id,
        parsed.data.version,
      );
    }
    if (parsed.data.secrets) {
      await writeIntegrationSecrets(c.env, user.id, parsed.data.secrets);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "ConfigValidationError") {
      return c.json(fail("validation_error", error.message), 400);
    }
    throw error;
  }
  return c.json(ok(await getAdminIntegrations(c.env)));
});

/**
 * Verify a credential without ever returning it. Turnstile's siteverify
 * distinguishes an invalid secret (`invalid-input-secret`) from a bad token.
 */
adminIntegrationRoutes.post("/api/admin/integrations/test", requireAdmin, async (c) => {
  const body = (await readJson(c)) as { service?: unknown } | null;
  const service = typeof body?.service === "string" ? body.service : "";
  const effective = await getEffectiveIntegrations(c.env);
  c.header("cache-control", "no-store");

  if (service === "resend") {
    const key = effective.secrets.resendApiKey;
    if (!key) return c.json(ok({ service, ok: false, message: "尚未配置 Resend API Key" }));
    try {
      const response = await fetch("https://api.resend.com/domains", {
        headers: { authorization: `Bearer ${key}`, accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      const detail = response.ok ? "" : (await response.text()).slice(0, 200);
      return c.json(
        ok({
          service,
          ok: response.ok,
          status: response.status,
          message: response.ok ? "Resend 凭据可用" : `Resend 返回 HTTP ${response.status}`,
          detail,
        }),
      );
    } catch {
      return c.json(ok({ service, ok: false, message: "无法连接 Resend" }));
    }
  }

  if (service === "turnstile") {
    const secret = effective.secrets.turnstileSecret;
    if (!secret) return c.json(ok({ service, ok: false, message: "尚未配置 Turnstile Secret" }));
    try {
      const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        body: new URLSearchParams({ secret, response: "XXXX.DUMMY.TOKEN.XXXX" }),
        signal: AbortSignal.timeout(8000),
      });
      const result = (await response.json().catch(() => null)) as { "error-codes"?: string[] } | null;
      const invalidSecret = result?.["error-codes"]?.includes("invalid-input-secret") ?? false;
      return c.json(
        ok({
          service,
          ok: !invalidSecret,
          message: invalidSecret ? "Turnstile Secret 无效" : "Turnstile Secret 格式有效",
        }),
      );
    } catch {
      return c.json(ok({ service, ok: false, message: "无法连接 Turnstile" }));
    }
  }

  if (service === "cloudflare") {
    const missing = [
      !effective.cloudflare.accountId ? "Account ID" : "",
      !effective.cloudflare.r2Bucket ? "R2 存储桶" : "",
      !effective.cloudflare.cdnUrl ? "CDN 地址" : "",
      !effective.secrets.r2AccessKeyId ? "R2 Access Key ID" : "",
      !effective.secrets.r2SecretAccessKey ? "R2 Secret Access Key" : "",
    ].filter(Boolean);
    return c.json(
      ok({
        service,
        ok: missing.length === 0,
        message: missing.length ? `缺少：${missing.join("、")}` : "Cloudflare/R2 配置齐全（未发起真实上传）",
      }),
    );
  }

  return c.json(fail("validation_error", "未知的测试服务"), 400);
});
