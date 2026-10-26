CREATE TABLE `post_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`topic_id` text NOT NULL,
	`post_id` text NOT NULL,
	`version` integer NOT NULL,
	`title` text,
	`content_md` text NOT NULL,
	`action` text NOT NULL,
	`editor_id` text NOT NULL,
	`reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`editor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "post_revisions_action_check" CHECK("post_revisions"."action" in ('edit','delete','restore'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `post_revisions_post_version_unique` ON `post_revisions` (`post_id`,`version`);--> statement-breakpoint
CREATE INDEX `post_revisions_post_idx` ON `post_revisions` (`post_id`,`version`);