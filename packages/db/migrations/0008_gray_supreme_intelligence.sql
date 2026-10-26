ALTER TABLE `topics` ADD `is_digest` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `topics_digest_idx` ON `topics` (`status`,`is_digest`,`last_post_at`);