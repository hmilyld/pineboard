-- FTS5 for Chinese bigram search. post_uid is UNINDEXED; rowid stays internal.
CREATE VIRTUAL TABLE `post_search` USING fts5(
  `post_uid` UNINDEXED,
  `topic_id` UNINDEXED,
  `title`,
  `tokens`,
  tokenize = 'unicode61 remove_diacritics 2'
);
