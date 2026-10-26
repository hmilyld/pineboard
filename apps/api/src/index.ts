import { app } from "./app";
import { runEmailDigest } from "./digest";
import { runDailyMaintenance } from "./maintenance";
import type { Bindings } from "./env";

/** Worker entry: Hono app plus the digest and daily-maintenance cron handlers. */
export default {
  fetch: app.fetch,
  async scheduled(event, env, ctx) {
    if (event.cron === "*/5 * * * *") {
      ctx.waitUntil(
        runEmailDigest(env).catch((error) => {
          console.error(JSON.stringify({ level: "error", job: "digest", message: error instanceof Error ? error.message : String(error) }));
        }),
      );
      return;
    }
    if (event.cron === "15 3 * * *") {
      ctx.waitUntil(
        runDailyMaintenance(env).catch((error) => {
          console.error(JSON.stringify({ level: "error", job: "daily", message: error instanceof Error ? error.message : String(error) }));
        }),
      );
    }
  },
} satisfies ExportedHandler<Bindings>;
