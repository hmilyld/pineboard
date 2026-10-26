<script setup lang="ts">
import type { Post, TopicSummary } from "@pineboard/shared";
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import AccountShell from "@/components/AccountShell.vue";
import AccountSkeleton from "@/components/AccountSkeleton.vue";
import EmptyState from "@/components/EmptyState.vue";
import ErrorState from "@/components/ErrorState.vue";
import LoadingRows from "@/components/LoadingRows.vue";
import PaginationBar from "@/components/PaginationBar.vue";
import RelativeTime from "@/components/RelativeTime.vue";
import TopicList from "@/components/TopicList.vue";
import { api, ApiClientError } from "@/lib/api";
import { withSkeletonDelay } from "@/lib/ui";
import { useAuthStore } from "@/stores/auth";

type ReplyItem = Post & { topic: { id: string; title: string; category: { slug: string; name: string } } };
type Profile = Awaited<ReturnType<typeof api.user>>;
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const profile = ref<Profile | null>(null);
const topics = ref<TopicSummary[]>([]);
const replies = ref<ReplyItem[]>([]);
const page = ref(1);
const totalPages = ref(1);
const total = ref(0);
const loading = ref(true);
const error = ref("");
const tab = computed<"topics" | "replies">(() => (route.query.tab === "replies" ? "replies" : "topics"));

async function load(nextPage = 1): Promise<void> {
  loading.value = true;
  error.value = "";
  page.value = nextPage;
  try {
    const profileData = await withSkeletonDelay(api.user(String(route.params.username)));
    profile.value = profileData;
    if (tab.value === "replies") {
      const data = await api.userReplies(profileData.username, nextPage);
      replies.value = data.items as unknown as ReplyItem[];
      totalPages.value = data.totalPages;
      total.value = data.total;
    } else {
      const data = await api.userTopics(profileData.username, nextPage);
      topics.value = data.items;
      totalPages.value = data.totalPages;
      total.value = data.total;
    }
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? cause.message : "用户加载失败";
  } finally {
    loading.value = false;
  }
}

function setTab(next: "topics" | "replies"): void {
  void router.replace({ query: next === "replies" ? { tab: "replies" } : {} });
}

onMounted(() => load());
watch(() => [route.params.username, route.query.tab], () => load(1));
</script>

<template>
  <ErrorState v-if="error" class="v2-container mt-6" :message="error" retry @retry="load()" />
  <AccountShell v-else-if="profile" :profile="profile" :active="tab" :is-self="auth.user?.id === profile.id" :topic-count="profile.topicCount" :reply-count="profile.replyCount" :like-count="profile.likeCount" :bookmark-count="profile.bookmarkCount">
    <div class="v2-section-head"><h2>{{ tab === "topics" ? "主题" : "回复" }}</h2><span>共 {{ total }} 个</span></div>
    <div v-if="loading" class="mt-3"><LoadingRows :rows="5" /></div>
    <div v-else class="v2-panel mt-3">
      <template v-if="tab === 'replies'">
        <div v-if="replies.length">
          <RouterLink v-for="reply in replies" :key="reply.id" :to="`/t/${reply.topic.id}`" class="block border-b border-line px-3 py-3 last:border-b-0 hover:bg-hover">
            <p class="text-[10.5px] text-muted-foreground">回复了《{{ reply.topic.title }}》 · <RelativeTime :seconds="reply.createdAt" /></p>
            <p class="mt-1 line-clamp-2 text-[12.5px] leading-6">{{ reply.contentText || "该回复已删除" }}</p>
          </RouterLink>
        </div>
        <EmptyState v-else message="还没有回复。" />
      </template>
      <TopicList v-else :topics="topics" empty="还没有发布主题。" />
      <div v-if="totalPages > 1" class="border-t border-line px-3"><PaginationBar :page="page" :total-pages="totalPages" :total="total" @change="load" /></div>
    </div>
  </AccountShell>
  <AccountSkeleton v-else />
</template>
