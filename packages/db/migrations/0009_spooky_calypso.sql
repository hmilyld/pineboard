CREATE TABLE `nav_items` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`href` text DEFAULT '' NOT NULL,
	`kind` text DEFAULT 'link' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_visible` integer DEFAULT true NOT NULL,
	`open_in_new_tab` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "nav_items_kind_check" CHECK("nav_items"."kind" in ('link','categories'))
);
--> statement-breakpoint
CREATE INDEX `nav_items_visible_order_idx` ON `nav_items` (`is_visible`,`sort_order`);--> statement-breakpoint
ALTER TABLE `categories` ADD `color` text DEFAULT '#14513f' NOT NULL;--> statement-breakpoint
UPDATE `categories` SET `color` = '#3c5a8a' WHERE `slug` IN ('general', 'gen');
--> statement-breakpoint
UPDATE `categories` SET `color` = '#14513f' WHERE `slug` IN ('tools', 'tool');
--> statement-breakpoint
UPDATE `categories` SET `color` = '#b4791a' WHERE `slug` IN ('games', 'game');
--> statement-breakpoint
UPDATE `categories` SET `color` = '#c0472b' WHERE `slug` = 'dev';
--> statement-breakpoint
UPDATE `categories` SET `color` = '#6b4c7a' WHERE `slug` = 'chat';
--> statement-breakpoint
INSERT OR IGNORE INTO `nav_items` (`id`, `label`, `href`, `kind`, `sort_order`, `is_visible`, `open_in_new_tab`, `created_at`, `updated_at`)
VALUES ('nav-home', '首页', '/', 'link', 10, 1, 0, unixepoch(), unixepoch());
--> statement-breakpoint
INSERT OR IGNORE INTO `nav_items` (`id`, `label`, `href`, `kind`, `sort_order`, `is_visible`, `open_in_new_tab`, `created_at`, `updated_at`)
VALUES ('nav-categories', '版块', '', 'categories', 20, 1, 0, unixepoch(), unixepoch());
--> statement-breakpoint
INSERT OR IGNORE INTO `nav_items` (`id`, `label`, `href`, `kind`, `sort_order`, `is_visible`, `open_in_new_tab`, `created_at`, `updated_at`)
VALUES ('nav-tags', '标签', '/tags', 'link', 30, 1, 0, unixepoch(), unixepoch());
