export function startOfDaySeconds(timeZone: string, at = Date.now()): number {
  const safeZone = timeZone || "Asia/Shanghai";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: safeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(at));
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    const year = get("year");
    const month = get("month");
    const day = get("day");
    const target = Date.UTC(year, month - 1, day);
    const offsetAt = (date: Date): number => {
      const zoned = new Intl.DateTimeFormat("en-US", {
        timeZone: safeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).formatToParts(date);
      const value = (type: string) => Number(zoned.find((part) => part.type === type)?.value ?? 0);
      const asUtc = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour") % 24, value("minute"), value("second"));
      return asUtc - Math.floor(date.getTime() / 1000) * 1000;
    };
    let guess = target - offsetAt(new Date(target));
    guess = target - offsetAt(new Date(guess));
    return Math.floor(guess / 1000);
  } catch {
    return Math.floor(at / 1000) - (Math.floor(at / 1000) % 86_400);
  }
}

export async function siteStats(db: D1Database, timeZone: string): Promise<{
  todayPosts: number;
  topics: number;
  replies: number;
  members: number;
}> {
  const today = startOfDaySeconds(timeZone);
  const row = await db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM posts p JOIN topics t ON t.id = p.topic_id
         WHERE p.status = 'published' AND t.status = 'published' AND p.created_at >= ?) AS today_posts,
       (SELECT COUNT(*) FROM topics t JOIN categories c ON c.id = t.category_id
         WHERE t.status = 'published' AND c.is_visible = 1) AS topics,
       (SELECT COUNT(*) FROM posts p JOIN topics t ON t.id = p.topic_id JOIN categories c ON c.id = t.category_id
         WHERE p.is_first = 0 AND p.status = 'published' AND t.status = 'published' AND c.is_visible = 1) AS replies,
       (SELECT COUNT(*) FROM user WHERE status = 'active') AS members`,
  ).bind(today).first<{ today_posts: number; topics: number; replies: number; members: number }>();
  return {
    todayPosts: Number(row?.today_posts ?? 0),
    topics: Number(row?.topics ?? 0),
    replies: Number(row?.replies ?? 0),
    members: Number(row?.members ?? 0),
  };
}
