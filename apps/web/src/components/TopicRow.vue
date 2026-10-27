<script setup lang="ts">
import type { TopicSummary } from "@pineboard/shared";
import { RouterLink } from "vue-router";
import RelativeTime from "@/components/RelativeTime.vue";
import { t } from "@/i18n";
import { categoryClass, categoryStyle } from "@/lib/category";

defineProps<{ topic: TopicSummary }>();
</script>

<template>
  <RouterLink :to="`/t/${topic.id}`" class="v2-row" :class="categoryClass(topic.category.slug)" :style="categoryStyle(topic.category.color)">
    <div class="min-w-0">
      <div class="v2-title">
        <span v-if="topic.pinLevel > 0" class="v2-flag pin">{{ topic.pinLevel === 2 ? t("topic.pinGlobal") : t("topic.pinCategory") }}</span>
        <span v-if="topic.isDigest" class="v2-flag good">{{ t("topic.digest") }}</span>
        {{ topic.title }}
      </div>
      <div class="v2-mmeta">
        <span class="v2-mcat">{{ topic.category.name }}</span>
        <span> · </span><RelativeTime :seconds="topic.lastPostAt" />
        <span> · {{ t("topic.replyCount", { count: topic.replyCount }) }}</span>
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
