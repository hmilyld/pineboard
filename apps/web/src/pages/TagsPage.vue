<script setup lang="ts">
import type { Tag } from "@pineboard/shared";
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import ErrorState from "@/components/ErrorState.vue";
import PageSkeleton from "@/components/PageSkeleton.vue";
import { intlLocale, t } from "@/i18n";
import { api } from "@/lib/api";
import { useConfigStore } from "@/stores/config";

const tags = ref<Tag[]>([]);
const q = ref("");
const loading = ref(true);
const error = ref("");
const ordered = computed(() =>
  [...tags.value].sort((a, b) => {
    const countA = Number(a.topicCount ?? a.usageCount ?? 0);
    const countB = Number(b.topicCount ?? b.usageCount ?? 0);
    return countB - countA || a.name.localeCompare(b.name, intlLocale());
  }),
);

const filtered = computed(() => {
  const query = q.value.trim().toLowerCase();
  if (!query) return ordered.value;
  return ordered.value.filter((tag) => tag.name.toLowerCase().includes(query) || tag.slug.includes(query));
});

const config = useConfigStore();

onMounted(async () => {
  try {
    tags.value = await api.tags();
  } catch (cause) {
    error.value = config.describeError(cause, "common.loadFailed");
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <main class="v2-page">
    <div class="v2-container">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="text-[20px] font-bold leading-[1.3] tracking-[-0.02em]">{{ t("tags.title") }}</h1>
          <p class="mt-1 text-[11.5px] text-muted-foreground">{{ t("tags.intro") }}</p>
        </div>
        <input v-model="q" class="v2-input h-8 w-[220px] text-[12px]" type="search" :placeholder="t('tags.searchPlaceholder')" :aria-label="t('tags.searchPlaceholder')" />
      </div>

      <div class="v2-main mt-4">
        <section class="min-w-0">
          <ErrorState v-if="error" :message="error" />
          <PageSkeleton v-else-if="loading" :rows="4" :header="false" narrow bare />
          <div v-else class="grid border-t border-line sm:grid-cols-2">
            <RouterLink v-for="tag in filtered" :key="tag.id" :to="`/tag/${tag.slug}`" class="group border-b border-line px-0 py-3 sm:px-3 sm:odd:border-r">
              <div class="flex items-baseline justify-between gap-3">
                <span class="text-[15px] font-semibold"><span class="mr-0.5 text-pine">#</span>{{ tag.name }}</span>
                <span class="num text-[10.5px] text-muted-foreground">{{ t("tags.topicCount", { count: tag.topicCount ?? tag.usageCount }) }}</span>
              </div>
              <p class="mt-1 truncate pl-[11px] text-[10.5px] text-muted-foreground group-hover:text-ink">{{ tag.recentTopic?.title ?? t("stats.noTopics") }}</p>
            </RouterLink>
            <p v-if="!filtered.length" class="v2-empty col-span-full">{{ q ? t("tags.noMatch", { query: q }) : t("tags.empty") }}</p>
          </div>
        </section>
        <aside class="v2-side">
          <section class="v2-mod">
            <h3>{{ t("tags.about") }}</h3>
            <p class="text-[10.5px] leading-6 text-muted-foreground">{{ t("tags.aboutBody") }}</p>
            <RouterLink to="/tags" class="mt-2 inline-block text-[11px] text-pine hover:underline">{{ t("tags.browseAll") }}</RouterLink>
          </section>
          <section v-if="ordered.length" class="v2-mod">
            <h3>{{ t("tags.maxTags") }}</h3>
            <RouterLink v-for="tag in ordered.slice(0, 8)" :key="`side-${tag.id}`" :to="`/tag/${tag.slug}`" class="flex items-center justify-between border-t border-line py-1.5 text-[11px] text-muted-foreground hover:text-ink">
              <span class="truncate">#{{ tag.name }}</span><span class="num">{{ tag.topicCount ?? tag.usageCount }}</span>
            </RouterLink>
          </section>
        </aside>
      </div>
    </div>
  </main>
</template>
