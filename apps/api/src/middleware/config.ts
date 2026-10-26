import type { MiddlewareHandler } from "hono";
import { getConfig } from "../config";
import type { AppEnv } from "../env";

export const loadConfig: MiddlewareHandler<AppEnv> = async (c, next) => {
  const loaded = await getConfig(c.env);
  c.set("config", loaded.config);
  c.set("configVersion", loaded.version);
  if (loaded.errors.length > 0) {
    console.warn(JSON.stringify({ level: "warn", event: "config_parse", errors: loaded.errors }));
  }
  await next();
};
