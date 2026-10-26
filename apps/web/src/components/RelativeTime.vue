<script setup lang="ts">
import { computed } from "vue";
import { formatDate, formatRelative } from "@/lib/time";

const props = defineProps<{ seconds: number; timezone?: string }>();
const title = computed(() => formatDate(props.seconds, props.timezone ?? "Asia/Shanghai"));
const label = computed(() => formatRelative(props.seconds));
</script>

<template>
  <time :datetime="new Date(seconds * 1000).toISOString()" :title="title">{{ label }}</time>
</template>
