<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { confirmDialog } from "@/lib/confirm";
import AdminSkeleton from "@/components/AdminSkeleton.vue";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { alertErrorClass, alertInfoClass } from "@/lib/ui";
import { formatDate } from "@/lib/time";
import { useConfigStore } from "@/stores/config";

type AuditRow = {
  id: string;
  actorName: string | null;
  actorUsername: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  meta: Record<string, unknown> | null;
  createdAt: number;
};

const config = useConfigStore();
const rows = ref<AuditRow[]>([]);
const loading = ref(true);
const busy = ref("");
const error = ref("");
const message = ref("");

const labels = computed<Record<string, string>>(() => ({
  "topic.delete": t("admin.audit.actionTopicDelete"),
  "post.delete": t("admin.audit.actionPostDelete"),
  "post.restore": t("admin.audit.actionPostRestore"),
  "category.moderator.add": t("admin.audit.actionModeratorAdd"),
  "category.moderator.remove": t("admin.audit.actionModeratorRemove"),
  "settings.update": t("admin.audit.actionSettings"),
  "integrations.secrets": t("admin.audit.actionSecrets"),
}));

function restoreId(row: AuditRow): string | null {
  if (row.action === "post.delete" || row.action === "topic.delete") {
    const firstPostId = row.meta?.firstPostId;
    if (row.action === "topic.delete" && typeof firstPostId === "string") return firstPostId;
    return row.targetId;
  }
  return null;
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    rows.value = (await api.auditLogs(200)) as unknown as AuditRow[];
  } catch (cause) {
    error.value = config.describeError(cause, "admin.audit.loadFailed");
  } finally {
    loading.value = false;
  }
}

async function restore(row: AuditRow): Promise<void> {
  const id = restoreId(row);
  if (!id) return;
  if (!(await confirmDialog({
    title: t("admin.audit.restoreTitle"),
    message: t("admin.audit.restoreBody"),
    confirmLabel: t("admin.audit.restore"),
  }))) return;
  busy.value = row.id;
  error.value = "";
  message.value = "";
  try {
    await api.restorePost(id);
    message.value = t("admin.audit.restored");
    await load();
  } catch (cause) {
    error.value = config.describeError(cause, "admin.audit.restoreFailed");
  } finally {
    busy.value = "";
  }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
      <div><h1 class="text-[19px] font-bold leading-[1.3]">{{ t("admin.nav.audit") }}</h1><p class="mt-1 text-[10.5px] text-muted-foreground">{{ t("admin.audit.subtitle") }}</p></div>
      <button type="button" class="v2-btn sm" :disabled="loading" @click="load">{{ t("admin.audit.refresh") }}</button>
    </div>
    <p v-if="error" :class="[alertErrorClass, 'mt-4']">{{ error }}</p>
    <p v-if="message" :class="[alertInfoClass, 'mt-4']">{{ message }}</p>
    <AdminSkeleton v-if="loading" class="mt-4" />
    <div v-else class="v2-admin-panel mt-4 overflow-x-auto">
      <table class="v2-admin-table min-w-[760px]">
        <thead><tr><th>{{ t("admin.audit.colTime") }}</th><th>{{ t("admin.audit.colActor") }}</th><th>{{ t("admin.audit.colAction") }}</th><th>{{ t("admin.audit.colTarget") }}</th><th>{{ t("admin.audit.colDetail") }}</th><th></th></tr></thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id">
            <td class="whitespace-nowrap p-3 text-muted-foreground">{{ formatDate(row.createdAt) }}</td>
            <td class="p-3">{{ row.actorName ?? t("admin.audit.system") }}<span v-if="row.actorUsername" class="ml-1 text-[10px] text-muted-foreground">@{{ row.actorUsername }}</span></td>
            <td class="p-3">{{ labels[row.action] ?? row.action }}</td>
            <td class="p-3 font-mono text-[10px] text-muted-foreground">{{ row.targetType ?? "—" }} {{ row.targetId?.slice(-8) ?? "" }}</td>
            <td class="max-w-[240px] truncate p-3 text-[10.5px] text-muted-foreground">{{ row.meta ? JSON.stringify(row.meta) : "—" }}</td>
            <td class="p-3 text-right">
              <button v-if="restoreId(row)" type="button" class="v2-btn sm" :disabled="busy === row.id" @click="restore(row)">{{ busy === row.id ? t("admin.audit.restoring") : t("admin.audit.restore") }}</button>
            </td>
          </tr>
          <tr v-if="!rows.length"><td colspan="6" class="p-6 text-center text-muted-foreground">{{ t("admin.audit.empty") }}</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
