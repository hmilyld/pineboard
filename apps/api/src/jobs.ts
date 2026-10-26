export async function markMaintenanceRun(env: { DB: D1Database }, job: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO settings (key, value_json, group_name, updated_at, version)
     VALUES (?, ?, 'maintenance', ?, 0)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
  ).bind(`maintenance.last.${job}`, JSON.stringify(now), now).run().catch(() => undefined);
}
