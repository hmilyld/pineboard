<script setup lang="ts">
import type { Category, SiteStats, Tag, TopicSort, TopicSummary } from "@pineboard/shared";
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import ErrorState from "@/components/ErrorState.vue";
import PageSkeleton from "@/components/PageSkeleton.vue";
import LoadingRows from "@/components/LoadingRows.vue";
import PaginationBar from "@/components/PaginationBar.vue";
import TopicList from "@/components/TopicList.vue";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { categoryClass, categoryStyle, sortLongLabel, sortTabLabel } from "@/lib/category";
import { useConfigStore } from "@/stores/config";
import { withSkeletonDelay } from "@/lib/ui";

type Filter = TopicSort | "digest";
const route = useRoute();
const router = useRouter();
const config = useConfigStore();
const category = ref<Category | null>(null);
const categories = ref<Category[]>([]);
const tags = ref<Tag[]>([]);
const topics = ref<TopicSummary[]>([]);
const stats = ref<SiteStats | null>(null);
const sort = ref<Filter>((["new", "hot", "digest"].includes(String(route.query.sort)) ? route.query.sort : "latest") as Filter);
const page = ref(Number(route.query.page ?? 1) || 1);
const total = ref(0);
const totalPages = ref(1);
const loading = ref(true);
const error = ref("");
const sideOpen = ref(false);
let loadSeq = 0;

const sortOptions = computed<Array<[Filter, string]>>(() =>
  (["latest", "new", "hot", "digest"] as const).map((key) => [key, sortTabLabel(key)]),
);
const filterLabel = computed(() => (sort.value === "digest" ? t("topicSort.digest") : sortLongLabel(sort.value)));

async function load(nextPage = page.value, nextSort = sort.value): Promise<void> {
  const seq = ++loadSeq;
  loading.value = true;
  error.value = "";
  page.value = Number.isFinite(nextPage) && nextPage > 0 ? Math.floor(nextPage) : 1;
  sort.value = nextSort;
  try {
    const slug = String(route.params.slug);
    const [categoryData, categoryList, topicData, siteData, tagData] = await withSkeletonDelay(Promise.all([
      api.category(slug),
      api.categories(),
      api.topics({ category: slug, sort: nextSort === "digest" ? "latest" : nextSort, page: page.value, perPage: config.config?.seo.topicsPerPage ?? 20, digest: nextSort === "digest" }),
      api.siteStats(),
      api.tags(),
    ]));
    if (seq !== loadSeq) return;
    category.value = categoryData;
    categories.value = categoryList;
    topics.value = topicData.items;
    total.value = topicData.total;
    totalPages.value = topicData.totalPages;
    stats.value = siteData;
    tags.value = tagData.slice(0, 12);
    const query: Record<string, string> = {};
    if (nextSort !== "latest") query.sort = nextSort;
    if (page.value > 1) query.page = String(page.value);
    if (route.query.sort !== query.sort || route.query.page !== query.page) {
      await router.replace({ query });
    }
  } catch (cause) {
    if (seq === loadSeq) error.value = config.describeError(cause, "common.loadFailed");
  } finally {
    if (seq === loadSeq) loading.value = false;
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
    <PageSkeleton v-if="loading && !category" :rows="8" />
    <div v-else class="v2-container">
      <nav class="v2-crumb mb-3"><RouterLink to="/">{{ t("page.home") }}</RouterLink><span class="sep">/</span><span>{{ category?.name ?? t("category.notFound") }}</span></nav>
      <header v-if="category" class="v2-cat-head mb-3 border-b border-line pb-3" :class="categoryClass(category.slug)" :style="categoryStyle(category.color)">
        <div class="flex flex-wrap items-end gap-x-5 gap-y-3">
          <div class="v2-cat-head-main min-w-0 flex-1">
            <h1 class="flex items-center gap-2 text-[20px] font-bold leading-[1.3] tracking-[-0.02em]"><i class="size-2.5 rounded-full" :style="{ background: 'var(--c)' }" />{{ category.name }}</h1>
            <p class="mt-1 text-[11.5px] text-muted-foreground">{{ category.description }}</p>
          </div>
          <div class="v2-cat-head-stats flex items-center gap-5">
            <div class="text-right"><b class="num block text-[15px] font-semibold">{{ category.stats?.topics ?? 0 }}</b><span class="text-[10px] text-muted-foreground">{{ t("stats.topics") }}</span></div>
            <div class="text-right"><b class="num block text-[15px] font-semibold">{{ category.stats?.todayTopics ?? 0 }}</b><span class="text-[10px] text-muted-foreground">{{ t("stats.today") }}</span></div>
            <div class="text-right"><b class="num block text-[15px] font-semibold">{{ category.stats?.replies ?? 0 }}</b><span class="text-[10px] text-muted-foreground">{{ t("stats.replies") }}</span></div>
            <RouterLink :to="`/new?category=${category.slug}`" class="v2-btn orange">{{ t("nav.newTopic") }}</RouterLink>
          </div>
        </div>
      </header>

      <div class="v2-main">
        <section class="v2-panel min-w-0">
          <div class="v2-bar">
            <div class="flex items-center gap-3" role="tablist" :aria-label="t('topicSort.filterLabel')">
              <button v-for="option in sortOptions" :key="option[0]" type="button" class="v2-tab" :data-active="sort === option[0]" role="tab" :aria-selected="sort === option[0]" @click="load(1, option[0])">{{ option[1] }}</button>
            </div>
            <span class="ml-auto text-[10.5px]">{{ t("stats.topicTotal", { count: total }) }} · {{ filterLabel }}</span>
          </div>
          <ErrorState v-if="error" :message="error" retry @retry="load()" />
          <LoadingRows v-else-if="loading" :rows="8" />
          <TopicList v-else :topics="topics" :empty="sort === 'digest' ? t('category.noDigestTopics') : t('category.noTopics')" />
          <div class="border-t border-line px-3">
            <PaginationBar :page="page" :total-pages="totalPages" :total="total" @change="load($event)" />
          </div>
        </section>

        <aside class="v2-side">
          <button type="button" class="v2-side-toggle" :aria-expanded="sideOpen" @click="sideOpen = !sideOpen">{{ t("stats.siteInfo") }} <span class="ml-auto text-[11px] text-muted-foreground">{{ sideOpen ? t("stats.collapse") : t("stats.expand") }}</span></button>
          <div class="v2-side-body" :class="{ '!block': sideOpen }">
          <section class="v2-mod">
            <h3>{{ t("page.categories") }}</h3>
            <RouterLink v-for="item in categories" :key="item.id" :to="`/c/${item.slug}`" class="v2-catrow" :class="categoryClass(item.slug)" :style="{ ...categoryStyle(item.color), ...(item.id === category?.id ? { background: 'var(--pine-soft)' } : {}) }">
              <span class="v2-catname"><i /><b>{{ item.name }}</b><span>{{ item.topicCount ?? 0 }}</span></span>
              <span class="v2-catlast">{{ item.recentTopic?.title ?? t("stats.noTopics") }}</span>
            </RouterLink>
          </section>
          <section class="v2-mod">
            <h3>{{ t("stats.siteInfo") }}</h3>
            <div class="v2-stats">
              <div class="v2-st"><b>{{ stats?.todayPosts ?? 0 }}</b><span>{{ t("stats.todayPosts") }}</span></div>
              <div class="v2-st"><b>{{ stats?.topics ?? 0 }}</b><span>{{ t("stats.topics") }}</span></div>
              <div class="v2-st"><b>{{ stats?.replies ?? 0 }}</b><span>{{ t("stats.replies") }}</span></div>
              <div class="v2-st"><b>{{ stats?.members ?? 0 }}</b><span>{{ t("stats.members") }}</span></div>
            </div>
          </section>
          <section v-if="tags.length" class="v2-mod">
            <h3>{{ t("stats.hotTags") }}</h3>
            <div class="v2-tags">
              <RouterLink v-for="tag in tags" :key="tag.id" :to="`/tag/${tag.slug}`" class="v2-tag">#{{ tag.name }}</RouterLink>
            </div>
          </section>
          </div>
        </aside>
      </div>
    </div>
  </main>
</template>
