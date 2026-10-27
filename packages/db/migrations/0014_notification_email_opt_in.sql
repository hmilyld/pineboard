-- Email notifications are opt-in. Moderation email was previously forced on
-- and could not be disabled, so clear the value that was written without the
-- user's choice. This UPDATE is idempotent.
UPDATE notification_preferences
   SET email_enabled = 0, updated_at = unixepoch()
 WHERE category = 'moderation' AND email_enabled = 1;
