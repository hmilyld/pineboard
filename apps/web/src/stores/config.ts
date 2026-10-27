import { DEFAULT_LOCALE, type Locale, type PublicConfig } from "@pineboard/shared";
import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import { errorMessage } from "@/i18n/errors";
import { currentLocale, setActiveLocale, t, toLocale } from "@/i18n";
import { api } from "@/lib/api";
import { setSiteTimeZone } from "@/lib/time";

export const useConfigStore = defineStore("config", () => {
  const config = ref<PublicConfig | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function load(force = false): Promise<void> {
    if (config.value && !force) return;
    loading.value = true;
    error.value = null;
    try {
      config.value = await api.site();
      syncRuntime();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : t("common.loadFailed");
    } finally {
      loading.value = false;
    }
  }

  const siteName = computed(() => config.value?.site.name ?? t("common.appName"));
  const tagline = computed(() => config.value?.site.tagline ?? "");
  const registrationOpen = computed(() => config.value?.account.registrationOpen ?? true);
  const turnstileEnabled = computed(() => config.value?.feature.turnstile ?? true);
  const turnstileSiteKey = computed(() => config.value?.turnstileSiteKey ?? "");

  /** The single UI language of the site, chosen in the admin panel. */
  const locale = computed<Locale>(() => toLocale(config.value?.site.language));

  /** Maintenance banner copy written by the operator, verbatim. */
  const maintenanceMessage = computed(() => config.value?.maintenance.message || t("maintenance.defaultMessage"));

  function syncRuntime(): void {
    setActiveLocale(locale.value);
    setSiteTimeZone(config.value?.site.timezone);
    if (config.value) document.title = siteName.value;
  }

  /** Localized message for an API failure; falls back to the server text. */
  function describeError(cause: unknown, fallbackKey: Parameters<typeof t>[0] = "common.loadFailed"): string {
    if (cause && typeof cause === "object" && "code" in cause) {
      const code = String((cause as { code: unknown }).code);
      const fallback = (cause as { message?: string }).message ?? t(fallbackKey);
      return errorMessage(code, currentLocale(), fallback);
    }
    return cause instanceof Error ? cause.message : t(fallbackKey);
  }

  // Re-apply the runtime whenever the operator changes the language.
  watch(locale, () => {
    if (config.value) syncRuntime();
  });

  return {
    config,
    loading,
    error,
    locale,
    load,
    siteName,
    tagline,
    registrationOpen,
    turnstileEnabled,
    turnstileSiteKey,
    maintenanceMessage,
    describeError,
  };
});
