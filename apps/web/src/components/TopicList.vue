<script setup lang="ts">
import type { TopicSummary } from "@pineboard/shared";
import EmptyState from "@/components/EmptyState.vue";
import TopicRow from "@/components/TopicRow.vue";
import { t } from "@/i18n";

defineProps<{ topics: TopicSummary[]; empty?: string }>();
</script>

<template>
  <div>
    <div v-if="topics.length">
      <div class="v2-thead">
        <span>{{ t("stats.topics") }}</span><span class="text-right">{{ t("stats.replies") }}</span><span class="text-right">{{ t("topic.viewsHead") }}</span><span class="text-right">{{ t("topicSort.latest-long") }}</span>
      </div>
      <TopicRow v-for="topic in topics" :key="topic.id" :topic="topic" />
    </div>
    <EmptyState v-else :message="empty ?? t('home.empty')" />
  </div>
</template>
