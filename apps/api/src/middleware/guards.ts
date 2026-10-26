import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env";
import { fail } from "@pineboard/shared";

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get("user")) {
    c.header("cache-control", "no-store");
    return c.json(fail("auth_required", "请先登录"), 401);
  }
  await next();
};

export const requireVerified: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get("user");
  if (!user) {
    c.header("cache-control", "no-store");
    return c.json(fail("auth_required", "请先登录"), 401);
  }
  if (user.status !== "active") {
    c.header("cache-control", "no-store");
    return c.json(fail("forbidden", "账户不可用"), 403);
  }
  if (!user.emailVerified && c.get("config").account.requireVerificationForWrite) {
    c.header("cache-control", "no-store");
    return c.json(fail("email_unverified", "请先验证邮箱"), 403);
  }
  await next();
};

export const requireActive: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get("user");
  if (!user) {
    c.header("cache-control", "no-store");
    return c.json(fail("auth_required", "请先登录"), 401);
  }
  if (user.status !== "active") {
    c.header("cache-control", "no-store");
    return c.json(fail("forbidden", "账户正在注销或不可用，无法执行此操作"), 403);
  }
  await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get("user");
  if (!user) {
    c.header("cache-control", "no-store");
    return c.json(fail("auth_required", "请先登录"), 401);
  }
  if (user.role !== "admin" || user.status !== "active") {
    c.header("cache-control", "no-store");
    return c.json(fail("forbidden", "需要管理员权限"), 403);
  }
  await next();
};

export const requireModerator: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get("user");
  if (!user) {
    c.header("cache-control", "no-store");
    return c.json(fail("auth_required", "请先登录"), 401);
  }
  if ((user.role !== "admin" && user.role !== "moderator") || user.status !== "active") {
    c.header("cache-control", "no-store");
    return c.json(fail("forbidden", "需要版主权限"), 403);
  }
  await next();
};
