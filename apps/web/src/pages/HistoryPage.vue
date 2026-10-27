<script setup lang="ts">
import type { Revision } from "@pineboard/shared";
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRoute } from "vue-router";
import MarkdownRenderer from "@/components/MarkdownRenderer.vue";
import PageSkeleton from "@/components/PageSkeleton.vue";
import RelativeTime from "@/components/RelativeTime.vue";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { useConfigStore } from "@/stores/config";
import { alertErrorClass, linkClass, withSkeletonDelay } from "@/lib/ui";

const route = useRoute();
const config = useConfigStore();
const revisions = ref<Revision[]>([]);
const error = ref("");
const loading = ref(true);
const selectedId = ref("");
const actionLabel = (action: string): string =>
  action === "edit" ? t("history.actionEdit") : action === "delete" ? t("history.actionDelete") : action === "restore" ? t("history.actionRestore") : action;
const selected = computed(() => revisions.value.find((item) => item.id === selectedId.value) ?? revisions.value[0] ?? null);

onMounted(async () => {
  try {
    const postId = typeof route.query.postId === "string" ? route.query.postId : undefined;
    revisions.value = await withSkeletonDelay(api.revisions(String(route.params.id), postId));
    selectedId.value = revisions.value[0]?.id ?? "";
  } catch (cause) {
    error.value = config.describeError(cause, "history.loadFailed");
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <main class="v2-page">
    <div class="v2-container">
      <div class="flex items-end justify-between gap-4"><h1 class="text-[20px] font-bold leading-[1.3]">{{ t("history.title") }}</h1><RouterLink :to="`/t/${route.params.id}`" class="text-[11.5px] text-muted-foreground hover:text-ink">{{ t("history.backToTopic") }}</RouterLink></div>
      <p v-if="error" :class="[alertErrorClass, 'mt-4']">{{ error }}</p>
      <PageSkeleton v-else-if="loading" class="mt-4" :rows="4" :header="false" narrow bare />
      <div v-else-if="!revisions.length" class="v2-empty mt-4">{{ t("history.empty") }}</div>
      <div v-else class="mt-4 grid gap-3 sm:grid-cols-[220px_minmax(0,1fr)]">
        <div class="border border-line bg-surface">
          <button v-for="revision in revisions" :key="revision.id" type="button" class="block w-full border-b border-line px-3 py-2.5 text-left last:border-b-0" :class="selected?.id === revision.id ? 'bg-pine-soft' : 'hover:bg-hover'" @click="selectedId = revision.id">
            <span class="num text-[10.5px] text-muted-foreground">v{{ revision.version }} · {{ actionLabel(revision.action) }}</span>
            <span class="mt-0.5 block truncate text-[12px] font-medium">{{ revision.title ?? t("history.noTitle") }}</span>
            <span class="mt-0.5 block text-[10px] text-muted-foreground">{{ revision.editor.name }} · <RelativeTime :seconds="revision.createdAt" /></span>
          </button>
        </div>
        <article v-if="selected" class="border border-line bg-surface p-4">
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line pb-2 text-[10.5px] text-muted-foreground">
            <span class="num">v{{ selected.version }}</span><span>{{ selected.editor.name }}</span><RelativeTime :seconds="selected.createdAt" /><span v-if="selected.reason">{{ t("history.reason", { reason: selected.reason }) }}</span>
          </div>
          <h2 v-if="selected.title" class="mt-3 text-[16px] font-semibold">{{ selected.title }}</h2>
          <div class="mt-2"><MarkdownRenderer :source="selected.contentMd" /></div>
        </article>
      </div>
    </div>
  </main>
</template>
