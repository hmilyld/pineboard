import { renderWranglerConfig } from "./wrangler-config.mjs";

try {
  const result = renderWranglerConfig();
  console.log(`wrote ${result.output}: ${result.workerName} / ${result.siteUrl}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
