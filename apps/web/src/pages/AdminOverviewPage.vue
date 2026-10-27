<script setup lang="ts">
import type { AdminOverview } from "@pineboard/shared";
import { confirmDialog } from "@/lib/confirm";
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import AdminSkeleton from "@/components/AdminSkeleton.vue";
import ErrorState from "@/components/ErrorState.vue";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/time";
import { useConfigStore } from "@/stores/config";

const config = useConfigStore();
const data = ref<AdminOverview | null>(null);
const error = ref("");
const busy = ref("");
const message = ref("");

const tools = computed(() => [
  { key: "reindex", name: t("admin.tools.reindex"), hint: t("admin.tools.reindexHint"), run: () => api.reindexSearch() },
  { key: "digest", name: t("admin.tools.digest"), hint: t("admin.tools.digestHint"), run: () => api.runDigest() },
  { key: "daily", name: t("admin.tools.daily"), hint: t("admin.tools.dailyHint"), run: () => api.runDailyMaintenance() },
  { key: "cleanup", name: t("admin.tools.cleanup"), hint: t("admin.tools.cleanupHint"), run: () => api.runAccountCleanup() },
]);

const reasonLabels = computed<Record<string, string>>(() => ({
  spam: t("report.spam"),
  abuse: t("report.abuse"),
  illegal: t("report.illegal"),
  off_topic: t("report.off_topic"),
  other: t("report.other"),
}));

async function load(): Promise<void> {
  try {
    data.value = await api.adminOverview();
  } catch (cause) {
    error.value = config.describeError(cause, "common.loadFailed");
  }
}

async function run(key: string, name: string, run: () => Promise<unknown>): Promise<void> {
  if (!(await confirmDialog({ title: name, message: t("admin.common.runConfirm"), confirmLabel: t("admin.common.run") }))) return;
  busy.value = key;
  message.value = "";
  try {
    await run();
    message.value = t("admin.overview.toolDone", { name });
    await load();
  } catch (cause) {
    message.value = cause && typeof cause === "object" && "code" in cause
      ? config.describeError(cause, "admin.overview.toolFailed")
      : t("admin.overview.toolFailed", { name });
  } finally {
    busy.value = "";
  }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
      <div><h1 class="text-[19px] font-bold leading-[1.3]">{{ t("admin.overview.title") }}</h1><p class="mt-1 text-[10.5px] text-muted-foreground">{{ t("admin.overview.subtitle") }}</p></div>
      <p class="text-[10.5px] text-muted-foreground">{{ t("admin.overview.configVersion", { version: data?.configVersion ?? "—" }) }}<span class="mx-1">·</span>{{ t("admin.overview.lastDeploy", { date: data?.lastDeployAt ? formatDate(data.lastDeployAt) : "—" }) }}</p>
    </div>
    <ErrorState v-if="error" class="mt-4" :message="error" retry @retry="load" />
    <AdminSkeleton v-else-if="!data" class="mt-4" />
    <template v-else>
      <div class="v2-admin-grid mt-3">
        <div class="v2-admin-card"><b>{{ data?.todayPosts ?? 0 }}</b><span>{{ t("admin.overview.todayPosts") }}</span></div>
        <div class="v2-admin-card"><b :class="data?.pendingReports ? '!text-[var(--orange)]' : ''">{{ data?.pendingReports ?? 0 }}</b><span>{{ t("admin.overview.pendingReports") }}</span></div>
        <div class="v2-admin-card"><b>{{ data?.newMembersWeek ?? 0 }}</b><span>{{ t("admin.overview.newMembers") }}</span></div>
        <div class="v2-admin-card"><b :class="data?.emailFailures ? '!text-[var(--orange)]' : ''">{{ data?.emailFailures ?? 0 }}</b><span>{{ t("admin.overview.emailFailures") }}</span></div>
      </div>

      <section class="v2-admin-panel mt-4">
        <div class="v2-admin-panel-head"><span>{{ t("admin.overview.pendingReports") }}</span><RouterLink to="/admin/reports" class="text-[10.5px] text-muted-foreground hover:text-ink">{{ t("admin.common.all") }} →</RouterLink></div>
        <div v-if="data?.pendingReportItems.length">
          <div v-for="item in data.pendingReportItems" :key="item.id" class="v2-admin-row">
            <div class="min-w-0"><p class="truncate text-[12.5px] font-semibold">{{ item.targetTitle }}</p><p class="mt-0.5 text-[10.5px] text-muted-foreground"><span class="mr-2 inline-block bg-[var(--amber-soft)] px-1 text-[var(--amber)]">{{ reasonLabels[item.reasonCode] ?? item.reasonCode }}</span>{{ item.reporterName }} · {{ formatDate(item.createdAt) }}</p></div>
            <RouterLink to="/admin/reports" class="v2-btn sm">{{ t("admin.common.view") }}</RouterLink>
          </div>
        </div>
        <p v-else class="p-6 text-center text-[11.5px] text-muted-foreground">{{ t("admin.overview.noReports") }}</p>
      </section>

      <section class="mt-4">
        <div class="mb-2 flex items-center justify-between"><h2 class="text-[12px] font-semibold">{{ t("admin.tools.title") }}</h2><p v-if="message" class="text-[10.5px] text-muted-foreground">{{ message }}</p></div>
        <div class="grid gap-2 sm:grid-cols-2">
          <div v-for="tool in tools" :key="tool.key" class="v2-admin-card flex items-center gap-3">
            <div class="min-w-0 flex-1"><p class="text-[11.5px] font-semibold">{{ tool.name }}</p><p class="mt-0.5 text-[10.5px] text-muted-foreground">{{ tool.hint }}</p><p class="mt-0.5 text-[10px] text-muted-foreground">{{ t("admin.tools.lastRun", { date: data?.jobs?.[tool.key] ? formatDate(data.jobs[tool.key]!) : "—" }) }}</p></div>
            <button type="button" class="v2-btn sm" :disabled="busy === tool.key" @click="run(tool.key, tool.name, tool.run)">{{ busy === tool.key ? t("admin.common.running") : t("admin.common.run") }}</button>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>
