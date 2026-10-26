CREATE TABLE `email_suppressions` (
	`email` text PRIMARY KEY NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `email_unsubscribe_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`category` text NOT NULL,
	`token_hash` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_unsubscribe_token_hash_unique` ON `email_unsubscribe_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `email_unsubscribe_user_idx` ON `email_unsubscribe_tokens` (`user_id`,`category`);--> statement-breakpoint
CREATE TABLE `notification_preferences` (
	`user_id` text NOT NULL,
	`category` text NOT NULL,
	`email_enabled` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `category`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "notification_preferences_category_check" CHECK("notification_preferences"."category" in ('topic_reply','post_reply','mention','moderation'))
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`actor_id` text,
	`topic_id` text NOT NULL,
	`post_id` text,
	`title` text NOT NULL,
	`snippet` text DEFAULT '' NOT NULL,
	`read_at` integer,
	`email_status` text DEFAULT 'pending' NOT NULL,
	`email_batch_key` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "notifications_type_check" CHECK("notifications"."type" in ('topic_reply','post_reply','mention','moderation','system')),
	CONSTRAINT "notifications_email_status_check" CHECK("notifications"."email_status" in ('pending','sent','skipped','failed'))
);
--> statement-breakpoint
CREATE INDEX `notifications_user_idx` ON `notifications` (`user_id`,`read_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `notifications_email_idx` ON `notifications` (`email_status`,`created_at`);