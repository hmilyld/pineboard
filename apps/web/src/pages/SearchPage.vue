<script setup lang="ts">
import type { SearchResponse, SearchSort, Tag, TopicSummary } from "@pineboard/shared";
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import ErrorState from "@/components/ErrorState.vue";
import PageSkeleton from "@/components/PageSkeleton.vue";
import PaginationBar from "@/components/PaginationBar.vue";
import RelativeTime from "@/components/RelativeTime.vue";
import { api, ApiClientError } from "@/lib/api";
import { withSkeletonDelay } from "@/lib/ui";
import { categoryClass, categoryStyle } from "@/lib/category";
import { useConfigStore } from "@/stores/config";

const route = useRoute();
const router = useRouter();
const config = useConfigStore();
const q = ref(typeof route.query.q === "string" ? route.query.q : "");
const sort = ref<SearchSort>(route.query.sort === "latest" ? "latest" : "relevance");
const result = ref<SearchResponse | null>(null);
const page = ref(Number(route.query.page ?? 1) || 1);
const loading = ref(false);
const error = ref("");
const tags = ref<Tag[]>([]);
const latest = ref<TopicSummary[]>([]);

function parts(text: string): Array<{ text: string; hit: boolean }> {
  const query = q.value.trim();
  if (!query) return [{ text, hit: false }];
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  return text.split(regex).filter(Boolean).map((piece) => ({ text: piece, hit: piece.toLowerCase() === query.toLowerCase() }));
}

async function load(nextPage = 1, nextSort = sort.value): Promise<void> {
  const query = q.value.trim();
  page.value = nextPage;
  sort.value = nextSort;
  result.value = null;
  error.value = "";
  if (!query) {
    if (!tags.value.length || !latest.value.length) {
      const [tagData, topicData] = await Promise.all([api.tags(), api.topics({ sort: "latest", perPage: 5 })]);
      tags.value = tagData.slice(0, 10);
      latest.value = topicData.items;
    }
    return;
  }
  loading.value = true;
  try {
    result.value = await withSkeletonDelay(api.search(query, nextPage, nextSort));
    if (!tags.value.length || !latest.value.length) {
      const [tagData, topicData] = await Promise.all([api.tags(), api.topics({ sort: "latest", perPage: 5 })]);
      tags.value = tagData.slice(0, 10);
      latest.value = topicData.items;
    }
    const nextQuery: Record<string, string> = { q: query };
    if (nextSort !== "relevance") nextQuery.sort = nextSort;
    if (nextPage > 1) nextQuery.page = String(nextPage);
    await router.replace({ query: nextQuery });
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? cause.message : "搜索失败";
  } finally {
    loading.value = false;
  }
}

function submit(): void {
  void load(1, sort.value);
}

function clear(): void {
  q.value = "";
  result.value = null;
  void router.replace({ query: {} });
  void load();
}

onMounted(() => {
  void config.load();
  void load();
});
watch(() => route.query.q, (value) => {
  q.value = typeof value === "string" ? value : "";
  void load(1, sort.value);
});
</script>

<template>
  <main class="v2-page">
    <div class="v2-container">
      <nav class="v2-crumb mb-3"><RouterLink to="/">首页</RouterLink><span class="sep">/</span><span>搜索</span></nav>
      <form class="flex h-11 items-stretch border border-line bg-surface" role="search" @submit.prevent="submit">
        <span class="grid w-11 place-items-center text-[15px] text-muted-foreground" aria-hidden="true">⌕</span>
        <input v-model="q" name="q" type="search" autocomplete="off" class="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground/60" placeholder="搜索主题、标签、用户" aria-label="搜索" />
        <button v-if="q" type="button" class="px-2 text-[14px] text-muted-foreground hover:text-ink" aria-label="清除搜索" @click="clear">×</button>
        <button type="submit" class="w-[72px] bg-pine text-[12.5px] font-medium text-on-pine">搜索</button>
      </form>

      <div class="v2-main mt-4">
        <section class="min-w-0">
          <ErrorState v-if="error" :message="error" retry @retry="load()" />
          <PageSkeleton v-else-if="loading" :rows="4" :header="false" bare />
          <template v-else-if="result">
            <div class="flex items-center justify-between border-b border-line pb-2 text-[11.5px] text-muted-foreground">
              <span>找到 {{ result.total }} 条结果</span>
              <span class="flex items-center gap-3">
                <button type="button" class="v2-tab" :data-active="sort === 'relevance'" :aria-pressed="sort === 'relevance'" @click="load(1, 'relevance')">相关度</button>
                <button type="button" class="v2-tab" :data-active="sort === 'latest'" :aria-pressed="sort === 'latest'" @click="load(1, 'latest')">最新</button>
              </span>
            </div>
            <div class="mt-3 border border-line bg-surface">
              <RouterLink v-for="item in result.items" :key="item.postId" :to="`/t/${item.topicId}${Math.ceil(item.floor / (config.config?.seo.postsPerPage ?? 20)) > 1 ? `?page=${Math.ceil(item.floor / (config.config?.seo.postsPerPage ?? 20))}` : ''}#post-${item.floor}`" class="block border-b border-line px-3.5 py-3 last:border-b-0 hover:bg-hover" :class="categoryClass(item.category.slug)" :style="categoryStyle(item.category.color)">
                <h2 class="truncate text-[15px] font-semibold leading-[1.45]">
                  <template v-for="(piece, index) in parts(item.topicTitle)" :key="index"><mark v-if="piece.hit" class="rounded-[1px] bg-[var(--amber-mark)] px-0.5 text-inherit">{{ piece.text }}</mark><template v-else>{{ piece.text }}</template></template>
                </h2>
                <p class="mt-1 line-clamp-2 text-[12.5px] leading-[1.7] text-muted-foreground">
                  <template v-for="(piece, index) in parts(item.snippet)" :key="index"><mark v-if="piece.hit" class="rounded-[1px] bg-[var(--amber-mark)] px-0.5 text-inherit">{{ piece.text }}</mark><template v-else>{{ piece.text }}</template></template>
                </p>
                <p class="mt-1 text-[10.5px] text-muted-foreground">
                  <span class="mr-1 inline-block size-1.5 rounded-full" :style="{ ...categoryStyle(item.category.color), background: 'var(--c)' }" />{{ item.category.name }} · {{ item.author.name }} · #{{ item.floor }} · <RelativeTime :seconds="item.createdAt" />
                </p>
              </RouterLink>
              <p v-if="!result.items.length" class="v2-empty">没有找到「{{ q }}」</p>
            </div>
            <PaginationBar v-if="result.total > 0" class="mt-3" :page="page" :total-pages="Math.max(1, Math.ceil(result.total / result.perPage))" :total="result.total" @change="load" />
          </template>
          <div v-else class="py-10 text-center">
            <p class="text-[15px] font-semibold">输入关键词开始搜索</p>
            <p class="mt-1 text-[11.5px] text-muted-foreground">搜索标题和正文，中文按两字词切分。</p>
          </div>
        </section>
        <aside class="v2-side">
          <section v-if="tags.length" class="v2-mod">
            <h3>热门标签</h3>
            <div class="v2-tags"><RouterLink v-for="tag in tags" :key="tag.id" :to="`/tag/${tag.slug}`" class="v2-tag">#{{ tag.name }}</RouterLink></div>
          </section>
          <section v-if="latest.length" class="v2-mod">
            <h3>最新主题</h3>
            <RouterLink v-for="item in latest" :key="item.id" :to="`/t/${item.id}`" class="flex items-center gap-2 border-b border-line py-2 text-[11px] last:border-b-0">
              <span class="inline-block size-1.5 rounded-full" :class="categoryClass(item.category.slug)" :style="{ ...categoryStyle(item.category.color), background: 'var(--c)' }" />
              <span class="min-w-0 flex-1 truncate">{{ item.title }}</span>
              <RelativeTime :seconds="item.lastPostAt" class="text-[10px] text-muted-foreground" />
            </RouterLink>
          </section>
        </aside>
      </div>
    </div>
  </main>
</template>
