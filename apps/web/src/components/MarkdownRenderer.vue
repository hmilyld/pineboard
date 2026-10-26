<script setup lang="ts">
import { computed } from "vue";
import { renderMarkdown } from "@/lib/markdown";
import { useConfigStore } from "@/stores/config";

const props = defineProps<{ source: string }>();
const config = useConfigStore();
const plain = computed(() => config.config?.feature.markdown === false);
const html = computed(() => renderMarkdown(props.source));
</script>

<template>
  <pre v-if="plain" class="whitespace-pre-wrap font-sans text-[0.9375rem] leading-7">{{ source }}</pre>
  <div v-else class="prose-forum" v-html="html" />
</template>
