# Spike harness

This directory is **throwaway verification code**, not the forum implementation. It exists to answer the five questions in `docs/06-roadmap-risks.md` before P0. The production monorepo will live in `apps/*` and `packages/*`; nothing here should be imported by P0.

## What is covered

| Script | Question | Result file |
|---|---|---|
| `scripts/spike2.mjs` | Better Auth on D1: signup / OAuth same-email link / reset, custom hasher, `waitUntil` | `results/spike2.json` |
| `scripts/spike3.mjs` | FTS5 writes, Chinese bigrams, batch + CAS, floor allocation | `results/spike3.json` |
| `scripts/spike4.mjs` | R2 presigned PUT, Content-Type binding, HEAD verification, MIME/size rejection | `results/spike4.json` |
| `scripts/spike1.mjs` | Single Worker doc request, meta injection, `caches.default`, cache throughput | `results/spike1.json` |
| `scripts/spike5.mjs` | Migration replay, data-only export/restore, deploy dry-run | `results/spike5.json` |
| `scripts/migration-probe.mjs` | FTS5 INSERT executed inside a D1 migration, isolated DB | stdout |
| `scripts/bench.mjs` | Server wall time / D1 rows per flow | `results/bench.json` |
| `scripts/cpu-remote.mjs` | Post-deploy bucket CPU via Cloudflare GraphQL (needs token) | stdout |
| `scripts/tail-cpu.mjs` | Per-request deployed CPU via `wrangler tail` (needs token) | stdout |

`pnpm test` starts `wrangler dev` if it is not already healthy, runs every suite, then kills the child. It assumes migrations have been applied once.

## Setup

```bash
cd spikes
pnpm install
pnpm db:migrate      # stop `wrangler dev` first; local D1 file lock
pnpm dev             # terminal 1 (http://127.0.0.1:8787)
pnpm test            # terminal 2
pnpm typecheck
```

Wrangler writes logs under `~/.config/.wrangler`, which may be read-only in sandboxed environments. If it fails with `ENOENT ... .config/.wrangler`, use:

```bash
XDG_CONFIG_HOME=$PWD/.config WRANGLER_LOG_PATH=$PWD/.wrangler/logs pnpm dev
```

## Important caveats

- `.dev.vars` is local-only and gitignored. Use `.dev.vars.example` as the template. OAuth test values are fake and point at the Worker's own mock token endpoint.
- The spike database contains two probe migrations (`0002`, `0003`) that write to `post_search` to prove migration writes work. They are not production migrations.
- Local D1/R2 is Miniflare. Real R2 acceptance, CORS, CDN behavior, remote D1 migrations, `wrangler rollback`, and GitHub Actions execution are **not** verified here because this environment has no Cloudflare credentials or Git remote.
- `wrangler d1 export` rejects databases with FTS5 virtual tables. The backup test exports every real table except `post_search`; a restore must rebuild the search index.
- `wrangler d1 export` has no `--persist-to`; the test creates an isolated config + `.wrangler/state` copy to export without touching the dev database.
- Billable CPU is not measurable in local workerd. `process.cpuUsage` is unavailable and the CDP profiler only sees the main isolate, while requests run in a separate isolate. Server wall time is recorded as an upper bound.
- After deploy, use `wrangler tail` via `scripts/tail-cpu.mjs`: it reports the actual per-request `cpuTime`. The GraphQL `cpuTimeP50` is bucketed and can be inflated by cold starts.

## Results summary (2026-10-22)

- 30/30 Better Auth assertions, 16/16 FTS assertions, 12/12 document assertions, 15/15 R2 assertions, 5/5 local pipeline steps.
- Better Auth never emits `BEGIN/COMMIT` with the default `transaction: false`; forcing `transaction: true` fails at `BEGIN` with a D1 error.
- OAuth into an unverified local account is refused by default (`account_not_linked`); with `requireLocalEmailVerified: false` + a `databaseHooks.account.create.before` guard, the credential account is deleted and sessions are revoked.
- 100 cached document requests: 100% cache hits, server P95 1ms. Cold miss P50 5ms / P95 8ms.
- R2 presign must pass `allHeaders: true` so `X-Amz-SignedHeaders` includes `content-type`; otherwise Content-Type is not bound. R2 does not support presigned POST, so size is enforced by HEAD + intent + quota.
- Chinese FTS works with bigrams; single CJK characters fall back to `LIKE`; 10 concurrent floor allocations and a CAS race behave correctly.
- D1 export cannot include FTS5; backups exclude `post_search` and require a reindex after restore.

## Remote verification (2026-10-22)

- Worker `pineboard` deployed at `https://pineboard.pineboard.workers.dev`; D1 `forum` created and migrated.
- Remote D1 export → gzip → R2 `forum-backups` upload/download checksum matched; restore drill into a temporary D1 passed and the temporary DB was deleted.
- Rollback drill: deployed a second version, rolled back to `3e970bea-6e9f-49f0-8b2b-bcdfa6f983da`, health endpoint confirmed the old version.
- `wrangler tail` on 10 warm `/api/health` requests: CPU p50 2ms, p95 7ms, max 7ms.
- R2 bucket `forum-assets` CORS and `forum-backups` 7-day `d1/` lifecycle are configured.
- Real R2 presigned PUT verified after reissuing the R2 S3 token: `X-Amz-SignedHeaders=content-type;host`, correct Content-Type PUT/HEAD 200, wrong Content-Type rejected with 403, then DELETE 204.
