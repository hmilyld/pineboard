CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`group_name` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL
);
