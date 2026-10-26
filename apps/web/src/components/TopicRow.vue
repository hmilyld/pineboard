<script setup lang="ts">
import type { TopicSummary } from "@pineboard/shared";
import { RouterLink } from "vue-router";
import RelativeTime from "@/components/RelativeTime.vue";
import { categoryClass, categoryStyle } from "@/lib/category";

defineProps<{ topic: TopicSummary }>();
</script>

<template>
  <RouterLink :to="`/t/${topic.id}`" class="v2-row" :class="categoryClass(topic.category.slug)" :style="categoryStyle(topic.category.color)">
    <div class="min-w-0">
      <div class="v2-title">
        <span v-if="topic.pinLevel > 0" class="v2-flag pin">{{ topic.pinLevel === 2 ? "全局置顶" : "置顶" }}</span>
        <span v-if="topic.isDigest" class="v2-flag good">精华</span>
        {{ topic.title }}
      </div>
      <div class="v2-mmeta">
        <span class="v2-mcat">{{ topic.category.name }}</span>
        <span> · </span><RelativeTime :seconds="topic.lastPostAt" />
        <span> · {{ topic.replyCount }} 回复</span>
      </div>
    </div>
    <span class="v2-num rep">{{ topic.replyCount }}</span>
    <span class="v2-num">{{ topic.viewCount }}</span>
    <span class="v2-last">
      <b>{{ topic.lastPostUser?.name ?? "—" }}</b>
      <RelativeTime :seconds="topic.lastPostAt" />
    </span>
  </RouterLink>
</template>
