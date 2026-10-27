<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import AdminSkeleton from "@/components/AdminSkeleton.vue";
import PaginationBar from "@/components/PaginationBar.vue";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { alertErrorClass, alertInfoClass, cardClass } from "@/lib/ui";
import { formatDate } from "@/lib/time";
import { useConfigStore } from "@/stores/config";

type Report = {
  id: string; reporter: { name: string; username: string | null }; targetType: string; targetId: string;
  topicId: string; postId: string | null; targetTitle: string; targetSnippet: string;
  reasonCode: string; detail: string; status: string; createdAt: number;
};
const config = useConfigStore();
const reports = ref<Report[]>([]);
const loading = ref(true);
const error = ref("");
const message = ref("");
const notes = ref<Record<string, string>>({});
const status = ref("pending");
const page = ref(1);
const total = ref(0);
const totalPages = ref(1);
const busy = ref("");

const reasonLabels = computed<Record<string, string>>(() => ({
  spam: t("report.spam"),
  abuse: t("report.abuse"),
  illegal: t("report.illegal"),
  off_topic: t("report.off_topic"),
  other: t("report.other"),
}));

async function load(nextPage = page.value): Promise<void> {
  loading.value = true;
  error.value = "";
  page.value = Number.isFinite(nextPage) && nextPage > 0 ? Math.floor(nextPage) : 1;
  try {
    const data = await api.modReports(status.value, page.value);
    reports.value = data.items as unknown as Report[];
    total.value = data.total;
    totalPages.value = data.totalPages;
  } catch (cause) {
    error.value = config.describeError(cause, "common.loadFailed");
  } finally {
    loading.value = false;
  }
}

async function resolve(report: Report, status: "resolved" | "dismissed"): Promise<void> {
  if (busy.value) return;
  busy.value = report.id;
  try {
    await api.resolveReport(report.id, { status, resolutionNote: notes.value[report.id] ?? "" });
    message.value = status === "resolved" ? t("admin.reports.resolved") : t("admin.reports.dismissed");
    await load(page.value);
  } catch (cause) {
    error.value = config.describeError(cause, "admin.reports.resolveFailed");
  } finally {
    busy.value = "";
  }
}

onMounted(() => load(1));
</script>

<template>
  <div>
    <div class="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
      <div><h1 class="text-[19px] font-bold leading-[1.3]">{{ t("admin.nav.reports") }}</h1><p class="mt-1 text-[10.5px] text-muted-foreground">{{ t("admin.reports.subtitle") }}</p></div>
      <RouterLink to="/" class="text-[11.5px] text-muted-foreground hover:text-ink">{{ t("admin.shell.backToForum") }}</RouterLink>
    </div>

    <p v-if="message" :class="[alertInfoClass, 'mt-6']">{{ message }}</p>
    <p v-if="error" :class="[alertErrorClass, 'mt-6']">{{ error }}</p>
    <AdminSkeleton v-if="loading" class="mt-4" />
    <div v-else-if="!reports.length" class="empty-state mt-6">
      {{ t("admin.reports.empty") }}
    </div>
    <div v-else class="mt-3 space-y-3">
      <article v-for="report in reports" :key="report.id" :class="cardClass">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span class="bg-destructive/10 px-1.5 py-0.5 text-destructive">{{ reasonLabels[report.reasonCode] ?? report.reasonCode }}</span>
          <span>{{ report.targetType === "topic" ? t("admin.reports.targetTopic") : t("admin.reports.targetPost") }}</span>
          <span>{{ report.reporter.name }}</span>
          <span>{{ formatDate(report.createdAt) }}</span>
        </div>
        <h2 class="mt-2 text-sm font-medium">
          <RouterLink :to="`/t/${report.topicId}`" class="hover:underline">{{ report.targetTitle }}</RouterLink>
        </h2>
        <p class="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">{{ report.targetSnippet }}</p>
        <p v-if="report.detail" class="mt-2 bg-hover p-2.5 text-[11px] leading-6 text-muted-foreground">{{ t("admin.reports.detail", { detail: report.detail }) }}</p>
        <input v-model="notes[report.id]" class="v2-input mt-2 h-8" :placeholder="t('admin.reports.notePlaceholder')" maxlength="500" :aria-label="t('admin.reports.noteLabel')" />
        <div class="mt-3 flex gap-2">
          <Button size="sm" :disabled="busy === report.id" @click="resolve(report, 'resolved')">{{ t("admin.reports.markResolved") }}</Button>
          <Button size="sm" variant="outline" :disabled="busy === report.id" @click="resolve(report, 'dismissed')">{{ t("admin.reports.markDismissed") }}</Button>
          <RouterLink :to="`/t/${report.topicId}`" class="ml-auto self-center text-xs text-muted-foreground hover:text-foreground">{{ t("admin.reports.viewContent") }}</RouterLink>
        </div>
      </article>
      <PaginationBar v-if="totalPages > 1" :page="page" :total-pages="totalPages" :total="total" :unit="t('admin.reports.unit')" @change="load" />
    </div>
  </div>
</template>
