import { DEFAULT_LOCALE, isSupportedLocale, type Locale } from "@pineboard/shared";
import { shallowRef } from "vue";
import { en } from "./en";
import { zhCN } from "./zh-CN";

/** Any dictionary shape; translations only need the same key tree. */
type Dictionary = typeof zhCN;

type Widened<T> = {
  -readonly [K in keyof T]: T[K] extends string ? string : Widened<T[K]>;
};

export const dictionaries: Record<Locale, Widened<Dictionary>> = {
  "zh-CN": zhCN,
  en,
};

/**
 * Dotted path through the dictionary, e.g. `"topic.like"`. Derived from the
 * Chinese dictionary so a typo is a typecheck error, not a runtime fallback.
 */
type Leaves<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string
    ? Prefix extends ""
      ? K
      : `${Prefix}.${K}`
    : Leaves<T[K], Prefix extends "" ? K : `${Prefix}.${K}`>;
}[keyof T & string];

export type MessageKey = Leaves<Dictionary>;

export type MessageParams = Record<string, string | number>;

function lookup(dict: Widened<Dictionary>, key: string): string | undefined {
  let cursor: unknown = dict;
  for (const part of key.split(".")) {
    if (typeof cursor !== "object" || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return typeof cursor === "string" ? cursor : undefined;
}

function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

let activeLocale: Locale = DEFAULT_LOCALE;

/**
 * Reactive read of the site language. `t()` depends on it so a language change
 * in the admin panel re-renders every translated string without a reload.
 */
export const localeRef = shallowRef<Locale>(DEFAULT_LOCALE);

/**
 * Translate in the site language. Missing keys fall back to the default locale
 * and finally to the key itself, so a stale PWA cache never renders blank text.
 *
 * There is no per-visitor switching: the operator picks one language and the
 * whole site renders it. This is only a reactive dependency on that value.
 */
export function t(key: MessageKey, params?: MessageParams): string {
  void localeRef.value;
  const value = lookup(dictionaries[activeLocale], key) ?? lookup(dictionaries[DEFAULT_LOCALE], key) ?? key;
  return interpolate(value, params);
}

export function currentLocale(): Locale {
  return activeLocale;
}

/** Intl-friendly BCP 47 tag for dates and relative times. */
export function intlLocale(): string {
  return activeLocale;
}

/** Coerce any configured value into a locale the dictionary ships. */
export function toLocale(value: string | null | undefined): Locale {
  return isSupportedLocale(value) ? value : DEFAULT_LOCALE;
}

/** Applied by the config store when `/api/site` loads or the language changes. */
export function setActiveLocale(locale: Locale): void {
  activeLocale = locale;
  localeRef.value = locale;
  const root = document.documentElement;
  root.lang = locale;
  root.dataset.locale = locale;
}
