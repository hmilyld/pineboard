<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { confirmDialog } from "@/lib/confirm";
import { formatDate } from "@/lib/time";
import AdminSkeleton from "@/components/AdminSkeleton.vue";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { useConfigStore } from "@/stores/config";

const config = useConfigStore();
const busy = ref("");
const loading = ref(true);
const jobs = ref<Record<string, number | null>>({});
const message = ref("");
const tools = computed(() => [
  { key: "reindex", name: t("admin.tools.reindex"), hint: t("admin.tools.reindexHintLong"), run: () => api.reindexSearch() },
  { key: "digest", name: t("admin.tools.digest"), hint: t("admin.tools.digestHintLong"), run: () => api.runDigest() },
  { key: "daily", name: t("admin.tools.daily"), hint: t("admin.tools.dailyHintLong"), run: () => api.runDailyMaintenance() },
  { key: "cleanup", name: t("admin.tools.cleanup"), hint: t("admin.tools.cleanupHintLong"), run: () => api.runAccountCleanup() },
]);

async function loadJobs(): Promise<void> {
  try {
    const data = await api.adminOverview();
    jobs.value = data.jobs ?? {};
  } catch { /* optional */ } finally {
    loading.value = false;
  }
}

onMounted(loadJobs);

async function run(key: string, name: string, action: () => Promise<unknown>): Promise<void> {
  if (!(await confirmDialog({ title: name, message: t("admin.common.runConfirm"), confirmLabel: t("admin.common.run") }))) return;
  busy.value = key;
  message.value = "";
  try {
    await action();
    message.value = t("admin.overview.toolDone", { name });
    await loadJobs();
  } catch (cause) {
    message.value = cause && typeof cause === "object" && "code" in cause
      ? config.describeError(cause, "admin.overview.toolFailed")
      : t("admin.overview.toolFailed", { name });
  } finally {
    busy.value = "";
  }
}
</script>

<template>
  <div>
    <div class="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
      <div><h1 class="text-[19px] font-bold leading-[1.3]">{{ t("admin.nav.maintenance") }}</h1><p class="mt-1 text-[10.5px] text-muted-foreground">{{ t("admin.maintenance.subtitle") }}</p></div>
      <p v-if="message" class="text-[10.5px] text-muted-foreground">{{ message }}</p>
    </div>
    <AdminSkeleton v-if="loading" class="mt-4" />
    <div v-else class="mt-3 grid gap-2 sm:grid-cols-2">
      <div v-for="tool in tools" :key="tool.key" class="v2-admin-card flex items-center gap-3">
        <div class="min-w-0 flex-1"><p class="text-[11.5px] font-semibold">{{ tool.name }}</p><p class="mt-0.5 text-[10.5px] leading-5 text-muted-foreground">{{ tool.hint }}</p><p class="mt-0.5 text-[10px] text-muted-foreground">{{ t("admin.tools.lastRun", { date: jobs[tool.key] ? formatDate(jobs[tool.key]!) : "—" }) }}</p></div>
        <button type="button" class="v2-btn sm" :disabled="busy === tool.key" @click="run(tool.key, tool.name, tool.run)">{{ busy === tool.key ? t("admin.common.running") : t("admin.common.run") }}</button>
      </div>
    </div>
    <p class="mt-3 text-[10.5px] leading-5 text-muted-foreground">{{ t("admin.maintenance.footer") }}</p>
  </div>
</template>
