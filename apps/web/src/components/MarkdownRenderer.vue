<script setup lang="ts">
import { computed } from "vue";
import { renderMarkdown } from "@/lib/markdown";
import { t } from "@/i18n";
import { useConfigStore } from "@/stores/config";

const props = defineProps<{ source: string }>();
const config = useConfigStore();
const plain = computed(() => config.config?.feature.markdown === false);
const html = computed(() => {
  const rendered = renderMarkdown(props.source);
  // Code blocks scroll horizontally; make them keyboard-reachable with a
  // region role and an accessible name. (html guide: scrollable <pre> needs
  // tabindex="0" + role="region" + accessible name.)
  return rendered.replace(/<pre>/g, `<pre tabindex="0" role="region" aria-label="${t("composer.codeBlock")}">`);
});
</script>

<template>
  <pre v-if="plain" class="whitespace-pre-wrap font-sans text-[0.9375rem] leading-7">{{ source }}</pre>
  <div v-else class="prose-forum" v-html="html" />
</template>
