import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();

function required(name, value) {
  if (!value) throw new Error(`缺少 ${name}`);
  return value;
}

export function renderWranglerConfig(values = process.env, output = "wrangler.site.jsonc") {
  const template = JSON.parse(readFileSync(`${ROOT}/wrangler.jsonc`, "utf8"));
  const workerName = required("WORKER_NAME", values.WORKER_NAME);
  const domain = required("DOMAIN", values.DOMAIN).replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  const siteUrl = required("SITE_URL", values.SITE_URL).replace(/\/$/, "");
  const d1Name = required("D1_DATABASE_NAME", values.D1_DATABASE_NAME);
  const d1Id = required("D1_DATABASE_ID", values.D1_DATABASE_ID);
  const r2Name = required("R2_BUCKET_NAME", values.R2_BUCKET_NAME);
  const cdnUrl = (values.CDN_URL ?? "").replace(/\/$/, "");
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(workerName)) throw new Error("WORKER_NAME 不合法");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) throw new Error("DOMAIN 不合法");
  if (!/^[0-9a-f-]{32,40}$/i.test(d1Id)) throw new Error("D1_DATABASE_ID 不合法");
  if (cdnUrl && !/^https:\/\//i.test(cdnUrl)) throw new Error("CDN_URL 必须是 https URL 或留空");

  template.name = workerName;
  template.d1_databases[0].database_name = d1Name;
  template.d1_databases[0].database_id = d1Id;
  template.r2_buckets[0].bucket_name = r2Name;
  template.routes[0].pattern = domain;
  template.vars.SITE_URL = siteUrl;
  template.vars.CDN_URL = cdnUrl;
  template.vars.R2_BUCKET_NAME = r2Name;
  template.vars.ENVIRONMENT = "production";
  writeFileSync(`${ROOT}/${output}`, `${JSON.stringify(template, null, 2)}\n`);
  return { workerName, domain, siteUrl, d1Name, d1Id, r2Name, cdnUrl, output };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = renderWranglerConfig();
    console.log(`wrote ${result.output}: ${result.workerName} / ${result.siteUrl}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
