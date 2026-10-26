-- Explicit additive-principle exception: SQLite cannot alter a CHECK constraint.
-- Rebuild nav_items once to add parent_id and the dropdown kind; all rows are copied.
PRAGMA foreign_keys=OFF;
CREATE TABLE `__new_nav_items` (
  `id` text PRIMARY KEY NOT NULL,
  `label` text NOT NULL,
  `href` text NOT NULL DEFAULT '',
  `kind` text NOT NULL DEFAULT 'link',
  `parent_id` text,
  `sort_order` integer NOT NULL DEFAULT 0,
  `is_visible` integer NOT NULL DEFAULT true,
  `open_in_new_tab` integer NOT NULL DEFAULT false,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  CONSTRAINT `nav_items_kind_check` CHECK(`kind` in ('link','categories','dropdown')),
  CONSTRAINT `nav_items_parent_fk` FOREIGN KEY (`parent_id`) REFERENCES `__new_nav_items`(`id`) ON DELETE CASCADE
);
INSERT INTO `__new_nav_items` (id,label,href,kind,parent_id,sort_order,is_visible,open_in_new_tab,created_at,updated_at)
  SELECT id,label,href,kind,NULL,sort_order,is_visible,open_in_new_tab,created_at,updated_at FROM `nav_items`;
DROP TABLE `nav_items`;
ALTER TABLE `__new_nav_items` RENAME TO `nav_items`;
CREATE INDEX IF NOT EXISTS `nav_items_visible_order_idx` ON `nav_items` (`is_visible`,`sort_order`);
PRAGMA foreign_keys=ON;
