import { intlLocale, t } from "@/i18n";

export function formatRelative(unixSeconds: number): string {
  const now = Date.now();
  const diff = unixSeconds * 1000 - now;
  const abs = Math.abs(diff);
  const formatter = new Intl.RelativeTimeFormat(intlLocale(), { numeric: "auto" });
  if (abs < 60_000) return formatter.format(0, "second");
  if (abs < 3_600_000) return formatter.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return formatter.format(Math.round(diff / 3_600_000), "hour");
  if (abs < 30 * 86_400_000) return formatter.format(Math.round(diff / 86_400_000), "day");
  return formatDate(unixSeconds);
}

export function formatDate(unixSeconds: number, timeZone?: string): string {
  return new Intl.DateTimeFormat(intlLocale(), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timeZone ?? defaultTimeZone(),
  }).format(new Date(unixSeconds * 1000));
}

export function formatDateOnly(unixSeconds: number, timeZone?: string): string {
  return new Intl.DateTimeFormat(intlLocale(), {
    dateStyle: "medium",
    timeZone: timeZone ?? defaultTimeZone(),
  }).format(new Date(unixSeconds * 1000));
}

/**
 * Site timezone injected by the config store, so date rendering follows the
 * operator's setting instead of a hard-coded zone.
 */
let siteTimeZone = "Asia/Shanghai";

export function setSiteTimeZone(timeZone: string | null | undefined): void {
  siteTimeZone = timeZone?.trim() || "Asia/Shanghai";
}

export function defaultTimeZone(): string {
  return siteTimeZone;
}

/** Kept for template use so a missing translation never renders the raw key. */
export function labelOrFallback(key: Parameters<typeof t>[0], fallback: string): string {
  const value = t(key);
  return value === key ? fallback : value;
}
