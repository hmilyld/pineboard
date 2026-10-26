import type { PublicConfig } from "@pineboard/shared";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { api } from "@/lib/api";

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
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : "配置加载失败";
    } finally {
      loading.value = false;
    }
  }

  const siteName = computed(() => config.value?.site.name ?? "论坛");
  const tagline = computed(() => config.value?.site.tagline ?? "");
  const registrationOpen = computed(() => config.value?.account.registrationOpen ?? true);
  const turnstileEnabled = computed(() => config.value?.feature.turnstile ?? true);
  const turnstileSiteKey = computed(() => config.value?.turnstileSiteKey ?? "");

  return {
    config,
    loading,
    error,
    load,
    siteName,
    tagline,
    registrationOpen,
    turnstileEnabled,
    turnstileSiteKey,
  };
});
