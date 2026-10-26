<script setup lang="ts">
import { onMounted, ref } from "vue";
import { confirmDialog } from "@/lib/confirm";
import AdminSkeleton from "@/components/AdminSkeleton.vue";
import { api, ApiClientError } from "@/lib/api";
import { alertErrorClass, alertInfoClass } from "@/lib/ui";
import { formatDate } from "@/lib/time";

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

const rows = ref<AuditRow[]>([]);
const loading = ref(true);
const busy = ref("");
const error = ref("");
const message = ref("");

const labels: Record<string, string> = {
  "topic.delete": "删除主题",
  "post.delete": "删除回复",
  "post.restore": "恢复内容",
  "category.moderator.add": "添加版主",
  "category.moderator.remove": "移除版主",
  "settings.update": "设置更新",
  "integrations.secrets": "集成密钥更新",
};

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
    error.value = cause instanceof ApiClientError ? cause.message : "加载审计日志失败";
  } finally {
    loading.value = false;
  }
}

async function restore(row: AuditRow): Promise<void> {
  const id = restoreId(row);
  if (!id) return;
  if (!(await confirmDialog({ title: "恢复内容", message: "恢复该内容？主题会连带恢复同一次删除的回复。", confirmLabel: "恢复" }))) return;
  busy.value = row.id;
  error.value = "";
  message.value = "";
  try {
    await api.restorePost(id);
    message.value = "内容已恢复，并已重算计数与搜索索引。";
    await load();
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? cause.message : "恢复失败";
  } finally {
    busy.value = "";
  }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
      <div><h1 class="text-[19px] font-bold leading-[1.3]">审计日志</h1><p class="mt-1 text-[10.5px] text-muted-foreground">最近 200 条后台操作；删除主题/回复可直接恢复。</p></div>
      <button type="button" class="v2-btn sm" :disabled="loading" @click="load">刷新</button>
    </div>
    <p v-if="error" :class="[alertErrorClass, 'mt-4']">{{ error }}</p>
    <p v-if="message" :class="[alertInfoClass, 'mt-4']">{{ message }}</p>
    <AdminSkeleton v-if="loading" class="mt-4" />
    <div v-else class="v2-admin-panel mt-4 overflow-x-auto">
      <table class="v2-admin-table min-w-[760px]">
        <thead><tr><th>时间</th><th>操作者</th><th>动作</th><th>目标</th><th>详情</th><th></th></tr></thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id">
            <td class="whitespace-nowrap p-3 text-muted-foreground">{{ formatDate(row.createdAt) }}</td>
            <td class="p-3">{{ row.actorName ?? "系统" }}<span v-if="row.actorUsername" class="ml-1 text-[10px] text-muted-foreground">@{{ row.actorUsername }}</span></td>
            <td class="p-3">{{ labels[row.action] ?? row.action }}</td>
            <td class="p-3 font-mono text-[10px] text-muted-foreground">{{ row.targetType ?? "—" }} {{ row.targetId?.slice(-8) ?? "" }}</td>
            <td class="max-w-[240px] truncate p-3 text-[10.5px] text-muted-foreground">{{ row.meta ? JSON.stringify(row.meta) : "—" }}</td>
            <td class="p-3 text-right">
              <button v-if="restoreId(row)" type="button" class="v2-btn sm" :disabled="busy === row.id" @click="restore(row)">{{ busy === row.id ? "恢复中…" : "恢复" }}</button>
            </td>
          </tr>
          <tr v-if="!rows.length"><td colspan="6" class="p-6 text-center text-muted-foreground">还没有审计记录。</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
