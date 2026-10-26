-- Default forum structure. Additive and idempotent; no user content.
INSERT OR IGNORE INTO categories (id, slug, name, description, sort_order, is_visible, created_at)
VALUES ('cat-general', 'general', '综合讨论', '随便聊聊，分享你的发现。', 0, 1, unixepoch());

INSERT OR IGNORE INTO tags (id, slug, name, description, color, usage_count, status, created_at)
VALUES
  ('tag-guide', 'guide', '攻略', '攻略与心得', '#2563eb', 0, 'active', unixepoch()),
  ('tag-help', 'help', '求助', '遇到问题，寻求帮助', '#d97706', 0, 'active', unixepoch()),
  ('tag-news', 'news', '资讯', '新闻与更新', '#059669', 0, 'active', unixepoch());
