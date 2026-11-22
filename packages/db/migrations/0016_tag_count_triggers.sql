-- Tag counts now feed `/api/tags` directly, so the column has to stay exact
-- between the daily reconciliations. It used to be incremented on create only,
-- which left the count inflated after a delete, a hide, a restore, a rejection
-- or an approval — up to 24h of a visibly wrong number.
--
-- Triggers keep the column correct for every status transition, including
-- paths added later, instead of patching each handler. The recompute is scoped
-- to one tag (or to the tags of one topic), so it stays cheap.
UPDATE `tags` SET `usage_count` = (
  SELECT COUNT(*) FROM `topic_tags` `tt` JOIN `topics` `t` ON `t`.`id` = `tt`.`topic_id`
   WHERE `tt`.`tag_id` = `tags`.`id` AND `t`.`status` = 'published'
);--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `tags_usage_topic_tag_insert`
AFTER INSERT ON `topic_tags`
BEGIN
  UPDATE `tags` SET `usage_count` = (
    SELECT COUNT(*) FROM `topic_tags` `tt` JOIN `topics` `t` ON `t`.`id` = `tt`.`topic_id`
     WHERE `tt`.`tag_id` = `tags`.`id` AND `t`.`status` = 'published'
  ) WHERE `id` = NEW.`tag_id`;
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `tags_usage_topic_tag_delete`
AFTER DELETE ON `topic_tags`
BEGIN
  UPDATE `tags` SET `usage_count` = (
    SELECT COUNT(*) FROM `topic_tags` `tt` JOIN `topics` `t` ON `t`.`id` = `tt`.`topic_id`
     WHERE `tt`.`tag_id` = `tags`.`id` AND `t`.`status` = 'published'
  ) WHERE `id` = OLD.`tag_id`;
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `tags_usage_topic_status`
AFTER UPDATE OF `status` ON `topics`
WHEN NEW.`status` IS NOT OLD.`status`
BEGIN
  UPDATE `tags` SET `usage_count` = (
    SELECT COUNT(*) FROM `topic_tags` `tt` JOIN `topics` `t` ON `t`.`id` = `tt`.`topic_id`
     WHERE `tt`.`tag_id` = `tags`.`id` AND `t`.`status` = 'published'
  ) WHERE `id` IN (SELECT `tag_id` FROM `topic_tags` WHERE `topic_id` = NEW.`id`);
END;
