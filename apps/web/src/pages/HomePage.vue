<script setup lang="ts">
import type { Category, SiteStats, Tag, TopicSort, TopicSummary } from "@pineboard/shared";
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import ErrorState from "@/components/ErrorState.vue";
import PageSkeleton from "@/components/PageSkeleton.vue";
import LoadingRows from "@/components/LoadingRows.vue";
import PaginationBar from "@/components/PaginationBar.vue";
import TopicList from "@/components/TopicList.vue";
import { api, ApiClientError } from "@/lib/api";
import { categoryClass, categoryStyle } from "@/lib/category";
import { withSkeletonDelay } from "@/lib/ui";
import { useConfigStore } from "@/stores/config";

const route = useRoute();
const router = useRouter();
const config = useConfigStore();
const categories = ref<Category[]>([]);
const topics = ref<TopicSummary[]>([]);
const tags = ref<Tag[]>([]);
const stats = ref<SiteStats | null>(null);
const total = ref(0);
const page = ref(Math.max(1, Number(route.query.page ?? 1) || 1));
const totalPages = ref(1);
const sort = ref<TopicSort>(route.query.sort === "new" || route.query.sort === "hot" ? route.query.sort : "latest");
const loading = ref(true);
const error = ref("");
const sideOpen = ref(false);
let loadSeq = 0;

const sortLabel = computed(() => (sort.value === "latest" ? "最后回复" : sort.value === "new" ? "发布时间" : "热度"));
const perPage = computed(() => config.config?.seo.topicsPerPage ?? 20);

async function load(nextPage = page.value, nextSort: TopicSort = sort.value): Promise<void> {
  const seq = ++loadSeq;
  loading.value = true;
  error.value = "";
  page.value = Number.isFinite(nextPage) && nextPage > 0 ? Math.floor(nextPage) : 1;
  sort.value = nextSort;
  try {
    const [categoryData, topicData, tagData, siteData] = await withSkeletonDelay(Promise.all([
      api.categories(),
      api.topics({ sort: nextSort, page: page.value, perPage: perPage.value }),
      api.tags(),
      api.siteStats(),
    ]));
    if (seq !== loadSeq) return;
    categories.value = categoryData;
    topics.value = topicData.items;
    total.value = topicData.total;
    totalPages.value = topicData.totalPages;
    tags.value = tagData.slice(0, 12);
    stats.value = siteData;
    if (topicData.page > topicData.totalPages && topicData.totalPages > 0) {
      page.value = topicData.totalPages;
      await load(page.value, nextSort);
      return;
    }
    page.value = topicData.page;
    const query: Record<string, string> = {};
    if (nextSort !== "latest") query.sort = nextSort;
    if (page.value > 1) query.page = String(page.value);
    if (route.query.sort !== query.sort || route.query.page !== query.page) {
      await router.replace({ query });
    }
  } catch (cause) {
    if (seq === loadSeq) error.value = cause instanceof ApiClientError ? cause.message : "加载失败";
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

function goPage(next: number): void {
  if (next === page.value) return;
  void load(next);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

onMounted(() => {
  void config.load();
  void load(page.value);
});

watch(
  () => [route.query.page, route.query.sort],
  () => {
    const nextPage = Math.max(1, Number(route.query.page ?? 1) || 1);
    const nextSort: TopicSort = route.query.sort === "new" || route.query.sort === "hot" ? route.query.sort : "latest";
    if (nextPage !== page.value || nextSort !== sort.value) void load(nextPage, nextSort);
  },
);
</script>

<template>
  <main class="v2-page">
    <h1 class="sr-only">{{ config.siteName }}</h1>
    <PageSkeleton v-if="loading && !topics.length" :rows="8" side />
    <div v-else class="v2-container">
      <div class="v2-main">
        <section class="v2-panel min-w-0">
          <div class="v2-bar">
            <div class="flex items-center gap-3" role="tablist" aria-label="主题排序">
              <button v-for="option in ([['latest', '最新回复'], ['new', '最新发布'], ['hot', '热门']] as const)" :key="option[0]" type="button" class="v2-tab" :data-active="sort === option[0]" role="tab" :aria-selected="sort === option[0]" @click="load(1, option[0])">
                {{ option[1] }}
              </button>
            </div>
            <span class="ml-auto text-[10.5px]">共 {{ total }} 个主题</span>
          </div>
          <ErrorState v-if="error" :message="error" retry @retry="load()" />
          <LoadingRows v-else-if="loading" :rows="8" />
          <TopicList v-else :topics="topics" empty="还没有主题，登录后发布第一个吧。" />
          <div v-if="totalPages > 1" class="border-t border-line px-3">
            <PaginationBar :page="page" :total-pages="totalPages" :total="total" @change="goPage" />
          </div>
        </section>

        <aside class="v2-side">
          <button type="button" class="v2-side-toggle" :aria-expanded="sideOpen" @click="sideOpen = !sideOpen">
            站点信息 <span class="ml-auto text-[11px] text-muted-foreground">{{ sideOpen ? "收起" : "展开" }}</span>
          </button>
          <div class="v2-side-body" :class="{ '!block': sideOpen }">
            <section class="v2-mod">
              <h3>版块</h3>
              <RouterLink v-for="category in categories" :key="category.id" :to="`/c/${category.slug}`" class="v2-catrow" :class="categoryClass(category.slug)" :style="categoryStyle(category.color)">
                <span class="v2-catname"><i /><b>{{ category.name }}</b><span>{{ category.topicCount ?? 0 }}</span></span>
                <span class="v2-catlast">{{ category.recentTopic?.title ?? "还没有主题" }}</span>
              </RouterLink>
            </section>

            <section class="v2-mod">
              <h3>站点</h3>
              <div class="v2-stats">
                <div class="v2-st"><b>{{ stats?.todayPosts ?? 0 }}</b><span>今日发帖</span></div>
                <div class="v2-st"><b>{{ stats?.topics ?? 0 }}</b><span>主题</span></div>
                <div class="v2-st"><b>{{ stats?.replies ?? 0 }}</b><span>回复</span></div>
                <div class="v2-st"><b>{{ stats?.members ?? 0 }}</b><span>成员</span></div>
              </div>
            </section>

            <section v-if="tags.length" class="v2-mod">
              <h3>热门标签</h3>
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
