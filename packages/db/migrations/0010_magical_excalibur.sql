ALTER TABLE `reports` ADD `category_id` text;--> statement-breakpoint
ALTER TABLE `reports` ADD `topic_id` text;--> statement-breakpoint
ALTER TABLE `reports` ADD `post_id` text;--> statement-breakpoint
ALTER TABLE `reports` ADD `target_title` text;--> statement-breakpoint
ALTER TABLE `reports` ADD `target_snippet` text;--> statement-breakpoint
CREATE INDEX `reports_category_idx` ON `reports` (`category_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `topic_tags_tag_idx` ON `topic_tags` (`tag_id`);--> statement-breakpoint
UPDATE `reports` SET
  `category_id` = (SELECT `t`.`category_id` FROM `topics` `t` WHERE `t`.`id` = `reports`.`target_id`),
  `topic_id` = `target_id`,
  `target_title` = (SELECT `p`.`title` FROM `posts` `p` WHERE `p`.`topic_id` = `reports`.`target_id` AND `p`.`is_first` = 1 LIMIT 1),
  `target_snippet` = (SELECT substr(`p`.`content_text`, 1, 160) FROM `posts` `p` WHERE `p`.`topic_id` = `reports`.`target_id` AND `p`.`is_first` = 1 LIMIT 1)
WHERE `target_type` = 'topic';
--> statement-breakpoint
UPDATE `reports` SET
  `post_id` = `target_id`,
  `topic_id` = (SELECT `p`.`topic_id` FROM `posts` `p` WHERE `p`.`id` = `reports`.`target_id`),
  `category_id` = (SELECT `t`.`category_id` FROM `posts` `p` JOIN `topics` `t` ON `t`.`id` = `p`.`topic_id` WHERE `p`.`id` = `reports`.`target_id`),
  `target_title` = (SELECT `fp`.`title` FROM `posts` `p` JOIN `posts` `fp` ON `fp`.`topic_id` = `p`.`topic_id` AND `fp`.`is_first` = 1 WHERE `p`.`id` = `reports`.`target_id` LIMIT 1),
  `target_snippet` = (SELECT substr(`p`.`content_text`, 1, 160) FROM `posts` `p` WHERE `p`.`id` = `reports`.`target_id`)
WHERE `target_type` = 'post';
