-- Dedicated global config version row for atomic optimistic locking.
INSERT OR IGNORE INTO settings (key, value_json, group_name, updated_at, version)
SELECT '__config_version', '{}', 'meta', unixepoch(), COALESCE(MAX(version), 0) FROM settings;
