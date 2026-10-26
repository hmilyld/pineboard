<script setup lang="ts">
import type { TagDetail, TopicSort, TopicSummary } from "@pineboard/shared";
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import ErrorState from "@/components/ErrorState.vue";
import PageSkeleton from "@/components/PageSkeleton.vue";
import LoadingRows from "@/components/LoadingRows.vue";
import PaginationBar from "@/components/PaginationBar.vue";
import TopicList from "@/components/TopicList.vue";
import { api, ApiClientError } from "@/lib/api";
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
const label = computed(() => (sort.value === "new" ? "最新发布" : sort.value === "latest" ? "最新回复" : "热门"));

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
    error.value = cause instanceof ApiClientError ? cause.message : "加载失败";
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
      <nav class="v2-crumb mb-3"><RouterLink to="/">首页</RouterLink><span class="sep">/</span><RouterLink to="/tags">标签</RouterLink><span class="sep">/</span><span>{{ tag?.name ?? String(route.params.slug) }}</span></nav>
      <header v-if="tag" class="mb-3 border-b border-line pb-3">
        <div class="flex flex-wrap items-end gap-x-5 gap-y-2">
          <div class="min-w-0 flex-1">
            <h1 class="text-[20px] font-bold leading-[1.3] tracking-[-0.02em]"><span class="mr-1 text-pine">#</span>{{ tag.name }}</h1>
            <p class="mt-1 text-[11.5px] text-muted-foreground">{{ tag.description }}</p>
          </div>
          <div class="flex gap-5 text-right">
            <div><b class="num block text-[15px] font-semibold">{{ tag.stats.topics }}</b><span class="text-[10px] text-muted-foreground">主题</span></div>
            <div><b class="num block text-[15px] font-semibold">{{ tag.stats.todayTopics }}</b><span class="text-[10px] text-muted-foreground">今日</span></div>
            <div><b class="num block text-[15px] font-semibold">{{ tag.stats.replies }}</b><span class="text-[10px] text-muted-foreground">回复</span></div>
          </div>
        </div>
      </header>

      <ErrorState v-if="error" :message="error" retry @retry="load()" />
      <div v-else class="v2-panel">
        <div class="v2-bar">
          <div class="flex items-center gap-3" role="tablist" aria-label="主题排序">
            <button v-for="option in ([['new', '最新发布'], ['latest', '最新回复'], ['hot', '热门']] as const)" :key="option[0]" type="button" class="v2-tab" :data-active="sort === option[0]" role="tab" :aria-selected="sort === option[0]" @click="load(1, option[0])">{{ option[1] }}</button>
          </div>
          <span class="ml-auto text-[10.5px]">共 {{ total }} 个主题 · {{ label }}</span>
        </div>
        <LoadingRows v-if="loading" :rows="6" />
        <template v-else>
          <TopicList :topics="topics" empty="这个标签还没有主题。" />
          <div class="border-t border-line px-3"><PaginationBar :page="page" :total-pages="totalPages" :total="total" @change="load" /></div>
        </template>
      </div>
        </section>
        <aside class="v2-side">
          <section class="v2-mod">
            <h3>标签说明</h3>
            <p class="text-[10.5px] leading-6 text-muted-foreground">标签聚合跨版块的相关主题；排序和分页只影响当前列表。</p>
            <RouterLink to="/tags" class="mt-2 inline-block text-[11px] text-pine hover:underline">浏览全部标签</RouterLink>
          </section>
        </aside>
      </div>
    </div>
  </main>
</template>
