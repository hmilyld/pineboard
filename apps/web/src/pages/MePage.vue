<script setup lang="ts">
import type { TopicSummary } from "@pineboard/shared";
import { computed, onMounted, ref } from "vue";
import AccountShell from "@/components/AccountShell.vue";
import AccountSkeleton from "@/components/AccountSkeleton.vue";
import EmptyState from "@/components/EmptyState.vue";
import ErrorState from "@/components/ErrorState.vue";
import LoadingRows from "@/components/LoadingRows.vue";
import PaginationBar from "@/components/PaginationBar.vue";
import TopicList from "@/components/TopicList.vue";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";
import { useConfigStore } from "@/stores/config";

const auth = useAuthStore();
const config = useConfigStore();
const summary = ref({ topicCount: 0, replyCount: 0, likeCount: 0, bookmarkCount: 0, unreadCount: 0 });
const topics = ref<TopicSummary[]>([]);
const page = ref(1);
const totalPages = ref(1);
const loading = ref(true);
const error = ref("");

const profile = computed(() => ({
  id: auth.user?.id ?? "",
  name: auth.user?.name ?? "",
  username: auth.user?.username ?? null,
  role: auth.user?.role ?? "user",
  bio: auth.user?.bio ?? null,
  createdAt: auth.user?.createdAt ?? 0,
}));

async function load(nextPage = page.value): Promise<void> {
  loading.value = true;
  error.value = "";
  page.value = nextPage;
  try {
    const [summaryData, topicData] = await Promise.all([api.meSummary(), api.myTopics(nextPage)]);
    summary.value = summaryData;
    topics.value = topicData.items;
    totalPages.value = topicData.totalPages;
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
</script>

<template>
  <AccountSkeleton v-if="!auth.user || (loading && !topics.length)" />
  <AccountShell v-else-if="auth.user" :profile="profile" active="topics" :topic-count="summary.topicCount" :reply-count="summary.replyCount" :like-count="summary.likeCount" :bookmark-count="summary.bookmarkCount" :notification-count="summary.unreadCount" is-self>
    <div class="v2-section-head">
      <h2>{{ t("account.myTopics") }}</h2><span>{{ t("account.totalCount", { count: summary.topicCount }) }}</span>
      <RouterLink to="/new" class="v2-btn solid sm">{{ t("account.newTopic") }}</RouterLink>
    </div>
    <ErrorState v-if="error" :message="error" retry @retry="load()" />
    <div v-else class="v2-panel">
      <LoadingRows v-if="loading" :rows="5" />
      <TopicList v-else :topics="topics" :empty="t('account.noTopics')" />
      <div v-if="totalPages > 1" class="border-t border-line px-3"><PaginationBar :page="page" :total-pages="totalPages" @change="load" /></div>
    </div>
  </AccountShell>
</template>
