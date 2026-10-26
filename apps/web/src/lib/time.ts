export function formatRelative(unixSeconds: number): string {
  const now = Date.now();
  const diff = unixSeconds * 1000 - now;
  const abs = Math.abs(diff);
  const formatter = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });
  if (abs < 60_000) return "刚刚";
  if (abs < 3_600_000) return formatter.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return formatter.format(Math.round(diff / 3_600_000), "hour");
  if (abs < 30 * 86_400_000) return formatter.format(Math.round(diff / 86_400_000), "day");
  return formatDate(unixSeconds);
}

export function formatDate(unixSeconds: number, timeZone = "Asia/Shanghai"): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(unixSeconds * 1000));
}

export function formatDateOnly(unixSeconds: number, timeZone = "Asia/Shanghai"): string {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeZone }).format(
    new Date(unixSeconds * 1000),
  );
}
