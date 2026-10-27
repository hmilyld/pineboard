<script setup lang="ts">
import type { SiteStats } from "@pineboard/shared";
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import BrandMark from "@/components/BrandMark.vue";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { useConfigStore } from "@/stores/config";

defineProps<{ title: string; subtitle?: string }>();
const config = useConfigStore();
const stats = ref<SiteStats | null>(null);

onMounted(() => {
  void config.load();
  void api.siteStats().then((data) => (stats.value = data)).catch(() => undefined);
});
</script>

<template>
  <main class="v2-auth">
    <div class="v2-auth-shell">
      <aside class="v2-auth-brand">
        <div class="flex items-center gap-2.5">
          <BrandMark :size="26" :show-name="false" />
          <div>
            <p class="text-[16px] font-bold leading-none">{{ config.siteName }}</p>
            <p class="mt-1 text-[10.5px] text-white/60">{{ config.tagline }}</p>
          </div>
        </div>
        <div class="my-auto py-10">
          <p class="max-w-[15em] text-[24px] font-semibold leading-[1.5] tracking-[-0.02em]">{{ t("auth.headline") }}<br />{{ t("auth.headlineBreak") }}</p>
          <p class="mt-4 max-w-[28em] text-[11px] leading-[1.85] text-white/65">{{ config.config?.site.description || t("auth.shellDescription") }}</p>
        </div>
        <div class="flex items-end justify-between gap-4">
          <div class="v2-auth-stats">
            <div class="v2-auth-stat"><b>{{ stats?.topics ?? "—" }}</b><span>{{ t("auth.shellStatsTopics") }}</span></div>
            <div class="v2-auth-stat"><b>{{ stats?.members ?? "—" }}</b><span>{{ t("auth.shellStatsMembers") }}</span></div>
            <div class="v2-auth-stat"><b>{{ stats?.todayPosts ?? "—" }}</b><span>{{ t("auth.shellStatsToday") }}</span></div>
          </div>
          <p class="text-[9px] text-white/45">Cloudflare Workers</p>
        </div>
      </aside>

      <section class="v2-auth-form">
        <div class="v2-auth-form-inner">
          <RouterLink to="/" class="ml-auto block w-fit text-[10.5px] text-muted-foreground hover:text-ink">← {{ t("auth.backHome") }}</RouterLink>
          <div class="mt-8 flex items-center gap-2 lg:hidden">
            <BrandMark :size="22" show-name name-class="text-[16px]" />
          </div>
          <h1 class="mt-4 text-[22px]">{{ title }}</h1>
          <p v-if="subtitle" class="v2-auth-sub">{{ subtitle }}</p>
          <div class="mt-6"><slot /></div>
          <div class="mt-6 border-t border-line pt-4 text-[11px] text-muted-foreground"><slot name="footer" /></div>
        </div>
      </section>
    </div>
  </main>
</template>
