CREATE TABLE `bookmarks` (
	`user_id` text NOT NULL,
	`topic_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `topic_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `bookmarks_user_idx` ON `bookmarks` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_visible` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_slug_unique` ON `categories` (`slug`);--> statement-breakpoint
CREATE INDEX `categories_visible_order_idx` ON `categories` (`is_visible`,`sort_order`);--> statement-breakpoint
CREATE TABLE `category_moderators` (
	`category_id` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`category_id`, `user_id`),
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `post_likes` (
	`user_id` text NOT NULL,
	`post_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `post_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `post_likes_post_idx` ON `post_likes` (`post_id`);--> statement-breakpoint
CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`topic_id` text NOT NULL,
	`author_id` text NOT NULL,
	`parent_post_id` text,
	`floor` integer NOT NULL,
	`is_first` integer DEFAULT false NOT NULL,
	`title` text,
	`content_md` text NOT NULL,
	`content_text` text NOT NULL,
	`status` text DEFAULT 'published' NOT NULL,
	`like_count` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`edit_count` integer DEFAULT 0 NOT NULL,
	`edited_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`deleted_by` text,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "posts_status_check" CHECK("posts"."status" in ('published','hidden','deleted','pending','rejected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `posts_topic_floor_unique` ON `posts` (`topic_id`,`floor`);--> statement-breakpoint
CREATE INDEX `posts_topic_idx` ON `posts` (`topic_id`,`status`,`floor`);--> statement-breakpoint
CREATE INDEX `posts_author_idx` ON `posts` (`author_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `posts_parent_idx` ON `posts` (`parent_post_id`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`color` text DEFAULT '#71717a' NOT NULL,
	`usage_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "tags_status_check" CHECK("tags"."status" in ('active','hidden','merged'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_slug_unique` ON `tags` (`slug`);--> statement-breakpoint
CREATE INDEX `tags_status_idx` ON `tags` (`status`);--> statement-breakpoint
CREATE TABLE `topic_tags` (
	`topic_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`topic_id`, `tag_id`),
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `topics` (
	`id` text PRIMARY KEY NOT NULL,
	`category_id` text NOT NULL,
	`author_id` text NOT NULL,
	`first_post_id` text,
	`status` text DEFAULT 'published' NOT NULL,
	`pin_level` integer DEFAULT 0 NOT NULL,
	`pin_order` integer DEFAULT 0 NOT NULL,
	`is_locked` integer DEFAULT false NOT NULL,
	`reply_count` integer DEFAULT 0 NOT NULL,
	`like_count` integer DEFAULT 0 NOT NULL,
	`view_count` integer DEFAULT 0 NOT NULL,
	`last_post_at` integer NOT NULL,
	`last_post_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`deleted_by` text,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "topics_pin_check" CHECK("topics"."pin_level" in (0,1,2)),
	CONSTRAINT "topics_status_check" CHECK("topics"."status" in ('published','hidden','deleted','pending','rejected'))
);
--> statement-breakpoint
CREATE INDEX `topics_list_idx` ON `topics` (`status`,`pin_level`,`pin_order`,`last_post_at`);--> statement-breakpoint
CREATE INDEX `topics_category_idx` ON `topics` (`status`,`category_id`,`pin_level`,`last_post_at`);--> statement-breakpoint
CREATE INDEX `topics_author_idx` ON `topics` (`author_id`,`created_at`);