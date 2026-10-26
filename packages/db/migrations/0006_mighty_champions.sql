CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`reporter_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`reason_code` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`handled_by` text,
	`handled_at` integer,
	`resolution_note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`reporter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "reports_target_type_check" CHECK("reports"."target_type" in ('topic','post')),
	CONSTRAINT "reports_status_check" CHECK("reports"."status" in ('pending','resolved','dismissed')),
	CONSTRAINT "reports_reason_check" CHECK("reports"."reason_code" in ('spam','abuse','illegal','off_topic','other'))
);
--> statement-breakpoint
CREATE INDEX `reports_status_idx` ON `reports` (`status`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `reports_pending_unique` ON `reports` (`reporter_id`,`target_type`,`target_id`) WHERE "reports"."status" = 'pending';