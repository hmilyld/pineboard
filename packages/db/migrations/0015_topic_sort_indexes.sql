-- Sorting indexes for the topic list.
--
-- Every `/api/topics` sort used to scan the whole published set and build a
-- temporary B-tree: `latest` orders by pin_level DESC / pin_order ASC /
-- last_post_at DESC (mixed directions, so the existing all-ASC index could not
-- be walked), `new` orders by created_at with no index at all, and `hot`
-- orders by an expression. On the D1 free tier the scan, not the sort, is what
-- costs: the bill counts rows read per request.
--
-- The category-scoped variants keep a sparse category from walking the global
-- index until it collects a full page. Additive: indexes only, no data or
-- column change.
CREATE INDEX IF NOT EXISTS `topics_created_idx` ON `topics` (`status`, `created_at` DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `topics_list_desc_idx` ON `topics` (`status`, `pin_level` DESC, `pin_order` ASC, `last_post_at` DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `topics_hot_idx` ON `topics` (`status`, (`reply_count` * 2 + `like_count` * 3) DESC, `last_post_at` DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `topics_created_cat_idx` ON `topics` (`status`, `category_id`, `created_at` DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `topics_list_desc_cat_idx` ON `topics` (`status`, `category_id`, `pin_level` DESC, `pin_order` ASC, `last_post_at` DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `topics_hot_cat_idx` ON `topics` (`status`, `category_id`, (`reply_count` * 2 + `like_count` * 3) DESC, `last_post_at` DESC);
