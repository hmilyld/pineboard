<script setup lang="ts">
import type { Post, TopicSummary } from "@pineboard/shared";
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import AccountShell from "@/components/AccountShell.vue";
import AccountSkeleton from "@/components/AccountSkeleton.vue";
import EmptyState from "@/components/EmptyState.vue";
import ErrorState from "@/components/ErrorState.vue";
import LoadingRows from "@/components/LoadingRows.vue";
import PaginationBar from "@/components/PaginationBar.vue";
import RelativeTime from "@/components/RelativeTime.vue";
import TopicList from "@/components/TopicList.vue";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";
import { useConfigStore } from "@/stores/config";

type ReplyItem = Post & { topic: { id: string; title: string; category: { slug: string; name: string } } };
const route = useRoute();
const auth = useAuthStore();
const config = useConfigStore();
const topics = ref<TopicSummary[]>([]);
const replies = ref<ReplyItem[]>([]);
const page = ref(1);
const totalPages = ref(1);
const total = ref(0);
const loading = ref(true);
const error = ref("");
const summary = ref({ topicCount: 0, replyCount: 0, likeCount: 0, bookmarkCount: 0, unreadCount: 0 });

const kind = computed<"topics" | "replies" | "bookmarks">(() => {
  if (route.name === "me-replies") return "replies";
  if (route.name === "me-bookmarks") return "bookmarks";
  return "topics";
});
const title = computed(() =>
  kind.value === "replies" ? t("account.repliesTitle") : kind.value === "bookmarks" ? t("account.bookmarksTitle") : t("account.topicsTitle"),
);
const profile = computed(() => ({
  id: auth.user?.id ?? "",
  name: auth.user?.name ?? "",
  username: auth.user?.username ?? null,
  role: auth.user?.role ?? "user",
  bio: auth.user?.bio ?? null,
  createdAt: auth.user?.createdAt ?? 0,
}));

async function load(nextPage = 1): Promise<void> {
  loading.value = true;
  error.value = "";
  page.value = nextPage;
  try {
    const summaryData = await api.meSummary();
    summary.value = summaryData;
    if (kind.value === "replies") {
      const data = await api.myReplies(nextPage);
      replies.value = data.items as unknown as ReplyItem[];
      totalPages.value = data.totalPages;
      total.value = data.total;
    } else {
      const data = kind.value === "bookmarks" ? await api.myBookmarks(nextPage) : await api.myTopics(nextPage);
      topics.value = data.items;
      totalPages.value = data.totalPages;
      total.value = data.total;
    }
  } catch (cause) {
    error.value = config.describeError(cause, "common.loadFailed");
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  if (!auth.loaded) void auth.refresh();
  void load();
});
watch(kind, () => load(1));
</script>

<template>
  <AccountSkeleton v-if="!auth.user || (loading && !topics.length && !replies.length)" />
  <AccountShell v-else-if="auth.user" :profile="profile" :active="kind" :topic-count="summary.topicCount" :reply-count="summary.replyCount" :like-count="summary.likeCount" :bookmark-count="summary.bookmarkCount" :notification-count="summary.unreadCount" is-self>
    <div class="v2-section-head">
      <h2>{{ title }}</h2><span>{{ t("account.totalCount", { count: total }) }}</span>
      <RouterLink v-if="kind === 'topics'" to="/new" class="v2-btn solid sm">{{ t("account.newTopic") }}</RouterLink>
    </div>
    <ErrorState v-if="error" :message="error" retry @retry="load(page)" />
    <div v-else class="v2-panel">
      <LoadingRows v-if="loading" :rows="5" />
      <template v-else-if="kind === 'replies'">
        <div v-if="replies.length">
          <RouterLink v-for="reply in replies" :key="reply.id" :to="`/t/${reply.topic.id}`" class="block border-b border-line px-3 py-3 last:border-b-0 hover:bg-hover">
            <p class="text-[10.5px] text-muted-foreground">{{ t("account.repliedIn", { title: reply.topic.title }) }} · <RelativeTime :seconds="reply.createdAt" /></p>
            <p class="mt-1 line-clamp-2 text-[12.5px] leading-6 text-ink">{{ reply.contentText || t("account.deletedReply") }}</p>
          </RouterLink>
        </div>
        <EmptyState v-else :message="t('account.noReplies')" />
      </template>
      <TopicList v-else :topics="topics" :empty="kind === 'bookmarks' ? t('account.noBookmarks') : t('account.noTopics')" />
      <div v-if="totalPages > 1" class="border-t border-line px-3"><PaginationBar :page="page" :total-pages="totalPages" :total="total" @change="load" /></div>
    </div>
  </AccountShell>
</template>
