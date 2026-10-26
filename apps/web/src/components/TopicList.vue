<script setup lang="ts">
import type { TopicSummary } from "@pineboard/shared";
import EmptyState from "@/components/EmptyState.vue";
import TopicRow from "@/components/TopicRow.vue";

defineProps<{ topics: TopicSummary[]; empty?: string }>();
</script>

<template>
  <div>
    <div v-if="topics.length">
      <div class="v2-thead">
        <span>主题</span><span class="text-right">回复</span><span class="text-right">查看</span><span class="text-right">最后回复</span>
      </div>
      <TopicRow v-for="topic in topics" :key="topic.id" :topic="topic" />
    </div>
    <EmptyState v-else :message="empty ?? '这里还没有主题。'" />
  </div>
</template>
