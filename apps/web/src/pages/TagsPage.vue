<script setup lang="ts">
import type { Tag } from "@pineboard/shared";
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import ErrorState from "@/components/ErrorState.vue";
import PageSkeleton from "@/components/PageSkeleton.vue";
import { api, ApiClientError } from "@/lib/api";

const tags = ref<Tag[]>([]);
const q = ref("");
const loading = ref(true);
const error = ref("");
const ordered = computed(() =>
  [...tags.value].sort((a, b) => {
    const countA = Number(a.topicCount ?? a.usageCount ?? 0);
    const countB = Number(b.topicCount ?? b.usageCount ?? 0);
    return countB - countA || a.name.localeCompare(b.name, "zh-CN");
  }),
);

const filtered = computed(() => {
  const query = q.value.trim().toLowerCase();
  if (!query) return ordered.value;
  return ordered.value.filter((tag) => tag.name.toLowerCase().includes(query) || tag.slug.includes(query));
});

onMounted(async () => {
  try {
    tags.value = await api.tags();
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? cause.message : "加载失败";
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
          <h1 class="text-[20px] font-bold leading-[1.3] tracking-[-0.02em]">标签</h1>
          <p class="mt-1 text-[11.5px] text-muted-foreground">用标签找到相关主题。标签不是分类，更像主题上的记号。</p>
        </div>
        <input v-model="q" class="v2-input h-8 w-[220px] text-[12px]" type="search" placeholder="搜索标签" aria-label="搜索标签" />
      </div>

      <div class="v2-main mt-4">
        <section class="min-w-0">
          <ErrorState v-if="error" :message="error" />
          <PageSkeleton v-else-if="loading" :rows="4" :header="false" narrow bare />
          <div v-else class="grid border-t border-line sm:grid-cols-2">
            <RouterLink v-for="tag in filtered" :key="tag.id" :to="`/tag/${tag.slug}`" class="group border-b border-line px-0 py-3 sm:px-3 sm:odd:border-r">
              <div class="flex items-baseline justify-between gap-3">
                <span class="text-[15px] font-semibold"><span class="mr-0.5 text-pine">#</span>{{ tag.name }}</span>
                <span class="num text-[10.5px] text-muted-foreground">{{ tag.topicCount ?? tag.usageCount }} 个主题</span>
              </div>
              <p class="mt-1 truncate pl-[11px] text-[10.5px] text-muted-foreground group-hover:text-ink">{{ tag.recentTopic?.title ?? "还没有主题" }}</p>
            </RouterLink>
            <p v-if="!filtered.length" class="v2-empty col-span-full">{{ q ? `没有找到「${q}」` : "还没有标签。" }}</p>
          </div>
        </section>
        <aside class="v2-side">
          <section class="v2-mod">
            <h3>标签说明</h3>
            <p class="text-[10.5px] leading-6 text-muted-foreground">标签是主题上的记号，可以跨版块聚合内容；一个主题最多 5 个标签。</p>
            <RouterLink to="/tags" class="mt-2 inline-block text-[11px] text-pine hover:underline">浏览全部标签</RouterLink>
          </section>
          <section v-if="ordered.length" class="v2-mod">
            <h3>主题最多</h3>
            <RouterLink v-for="tag in ordered.slice(0, 8)" :key="`side-${tag.id}`" :to="`/tag/${tag.slug}`" class="flex items-center justify-between border-t border-line py-1.5 text-[11px] text-muted-foreground hover:text-ink">
              <span class="truncate">#{{ tag.name }}</span><span class="num">{{ tag.topicCount ?? tag.usageCount }}</span>
            </RouterLink>
          </section>
        </aside>
      </div>
    </div>
  </main>
</template>
