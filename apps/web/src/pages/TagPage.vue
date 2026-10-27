<script setup lang="ts">
import type { TagDetail, TopicSort, TopicSummary } from "@pineboard/shared";
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import ErrorState from "@/components/ErrorState.vue";
import PageSkeleton from "@/components/PageSkeleton.vue";
import LoadingRows from "@/components/LoadingRows.vue";
import PaginationBar from "@/components/PaginationBar.vue";
import TopicList from "@/components/TopicList.vue";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { sortLongLabel, sortTabLabel } from "@/lib/category";
import { useConfigStore } from "@/stores/config";
import { withSkeletonDelay } from "@/lib/ui";

const route = useRoute();
const router = useRouter();
const config = useConfigStore();
const tag = ref<TagDetail | null>(null);
const topics = ref<TopicSummary[]>([]);
const page = ref(1);
const totalPages = ref(1);
const total = ref(0);
const loading = ref(true);
const error = ref("");
const sort = ref<TopicSort>((["latest", "hot"].includes(String(route.query.sort)) ? route.query.sort : "new") as TopicSort);
const label = computed(() => sortLongLabel(sort.value));
const sortOptions = computed<Array<[TopicSort, string]>>(() =>
  (["new", "latest", "hot"] as const).map((key) => [key, sortTabLabel(key)]),
);

async function load(nextPage = 1, nextSort = sort.value): Promise<void> {
  loading.value = true;
  error.value = "";
  page.value = nextPage;
  sort.value = nextSort;
  try {
    const slug = String(route.params.slug);
    const [tagData, topicData] = await withSkeletonDelay(Promise.all([
      api.tag(slug),
      api.topics({ tag: slug, sort: nextSort, page: nextPage, perPage: config.config?.seo.topicsPerPage ?? 20 }),
    ]));
    tag.value = tagData;
    topics.value = topicData.items;
    totalPages.value = topicData.totalPages;
    total.value = topicData.total;
    const query: Record<string, string> = {};
    if (nextSort !== "new") query.sort = nextSort;
    if (nextPage > 1) query.page = String(nextPage);
    if (route.query.sort !== query.sort || route.query.page !== query.page) await router.replace({ query });
  } catch (cause) {
    error.value = config.describeError(cause, "common.loadFailed");
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void config.load();
  void load();
});
watch(() => route.params.slug, () => load(1));
</script>

<template>
  <main class="v2-page">
    <PageSkeleton v-if="loading && !tag" :rows="6" narrow />
    <div v-else class="v2-container">
      <div class="v2-main">
        <section class="min-w-0">
      <nav class="v2-crumb mb-3"><RouterLink to="/">{{ t("page.home") }}</RouterLink><span class="sep">/</span><RouterLink to="/tags">{{ t("page.tags") }}</RouterLink><span class="sep">/</span><span>{{ tag?.name ?? String(route.params.slug) }}</span></nav>
      <header v-if="tag" class="mb-3 border-b border-line pb-3">
        <div class="flex flex-wrap items-end gap-x-5 gap-y-2">
          <div class="min-w-0 flex-1">
            <h1 class="text-[20px] font-bold leading-[1.3] tracking-[-0.02em]"><span class="mr-1 text-pine">#</span>{{ tag.name }}</h1>
            <p class="mt-1 text-[11.5px] text-muted-foreground">{{ tag.description }}</p>
          </div>
          <div class="flex gap-5 text-right">
            <div><b class="num block text-[15px] font-semibold">{{ tag.stats.topics }}</b><span class="text-[10px] text-muted-foreground">{{ t("stats.topics") }}</span></div>
            <div><b class="num block text-[15px] font-semibold">{{ tag.stats.todayTopics }}</b><span class="text-[10px] text-muted-foreground">{{ t("stats.today") }}</span></div>
            <div><b class="num block text-[15px] font-semibold">{{ tag.stats.replies }}</b><span class="text-[10px] text-muted-foreground">{{ t("stats.replies") }}</span></div>
          </div>
        </div>
      </header>

      <ErrorState v-if="error" :message="error" retry @retry="load()" />
      <div v-else class="v2-panel">
        <div class="v2-bar">
          <div class="flex items-center gap-3" role="tablist" :aria-label="t('topicSort.label')">
            <button v-for="option in sortOptions" :key="option[0]" type="button" class="v2-tab" :data-active="sort === option[0]" role="tab" :aria-selected="sort === option[0]" @click="load(1, option[0])">{{ option[1] }}</button>
          </div>
          <span class="ml-auto text-[10.5px]">{{ t("tags.tagTotal", { count: total, sort: label }) }}</span>
        </div>
        <LoadingRows v-if="loading" :rows="6" />
        <template v-else>
          <TopicList :topics="topics" :empty="t('tags.noTagTopics')" />
          <div class="border-t border-line px-3"><PaginationBar :page="page" :total-pages="totalPages" :total="total" @change="load" /></div>
        </template>
      </div>
        </section>
        <aside class="v2-side">
          <section class="v2-mod">
            <h3>{{ t("tags.tagAbout") }}</h3>
            <p class="text-[10.5px] leading-6 text-muted-foreground">{{ t("tags.tagAboutBody") }}</p>
            <RouterLink to="/tags" class="mt-2 inline-block text-[11px] text-pine hover:underline">{{ t("tags.browseAll") }}</RouterLink>
          </section>
        </aside>
      </div>
    </div>
  </main>
</template>
