// Remote CPU/quota measurement. Requires a Cloudflare API token with
// Account Analytics Read + Workers Scripts Read.
//
//   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... \
//   CF_WORKER_NAME=pineboard node scripts/cpu-remote.mjs
//
// Run this after the P0 deploy; local workerd cannot expose billable CPU.
const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const script = process.env.CF_WORKER_NAME ?? "pineboard";

if (!token || !account) {
  console.error("Missing CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID");
  console.error("This spike cannot measure billable CPU without Cloudflare credentials.");
  process.exit(2);
}

const to = new Date();
const from = new Date(to.getTime() - 24 * 3600 * 1000);
const query = `
  query SpikeCpu($account: String!, $script: String!, $from: Time!, $to: Time!) {
    viewer {
      accounts(filter: { accountTag: $account }) {
        workersInvocationsAdaptive(
          limit: 10000
          filter: { scriptName: $script, datetime_geq: $from, datetime_leq: $to }
        ) {
          sum { requests errors }
          quantiles { cpuTimeP50 cpuTimeP99 }
          dimensions { datetime }
        }
      }
    }
  }
`;

const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
  method: "POST",
  headers: {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    query,
    variables: {
      account,
      script,
      from: from.toISOString(),
      to: to.toISOString(),
    },
  }),
});
const body = await response.json();
if (!response.ok || body.errors) {
  console.error(JSON.stringify(body.errors ?? body, null, 2));
  process.exit(1);
}
const groups = body.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive ?? [];
const p50s = groups.map((group) => group.quantiles.cpuTimeP50 ?? 0).sort((a, b) => a - b);
const p99s = groups.map((group) => group.quantiles.cpuTimeP99 ?? 0).sort((a, b) => a - b);
const median = (values) => (values.length ? values[Math.floor(values.length / 2)] : 0);
const totals = groups.reduce(
  (acc, group) => {
    acc.requests += group.sum.requests;
    acc.errors += group.sum.errors;
    return acc;
  },
  { requests: 0, errors: 0 },
);
console.log(
  JSON.stringify(
    {
      script,
      window: { from, to },
      groups: groups.length,
      ...totals,
      // These are per-bucket quantiles in microseconds. Cold starts inflate
      // them, so use `wrangler tail` (spikes/scripts/tail-cpu.mjs) for
      // per-request CPU instead of treating the max as steady-state.
      cpuP50MedianUs: median(p50s),
      cpuP50MaxUs: p50s.at(-1) ?? 0,
      cpuP99MaxUs: p99s.at(-1) ?? 0,
    },
    null,
    2,
  ),
);
