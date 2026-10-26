<script setup lang="ts">
import { onMounted, ref } from "vue";
import { confirmDialog } from "@/lib/confirm";
import { formatDate } from "@/lib/time";
import AdminSkeleton from "@/components/AdminSkeleton.vue";
import { api, ApiClientError } from "@/lib/api";

const busy = ref("");
const loading = ref(true);
const jobs = ref<Record<string, number | null>>({});
const message = ref("");
const tools = [
  { key: "reindex", name: "重建搜索索引", hint: "从 posts 重写 FTS 派生索引。", run: () => api.reindexSearch() },
  { key: "digest", name: "立即执行邮件摘要", hint: "处理待发通知，受全局与用户日预算限制。", run: () => api.runDigest() },
  { key: "daily", name: "每日清理与对账", hint: "清理过期 session、验证、限额，并重算计数。", run: () => api.runDailyMaintenance() },
  { key: "cleanup", name: "注销账户清理", hint: "匿名化已过冷静期的账户，保留内容。", run: () => api.runAccountCleanup() },
];

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
  if (!(await confirmDialog({ title: name, message: "此操作会立即改变线上数据。", confirmLabel: "执行" }))) return;
  busy.value = key;
  message.value = "";
  try {
    await action();
    message.value = `${name} 已完成。`;
    await loadJobs();
  } catch (cause) {
    message.value = cause instanceof ApiClientError ? cause.message : `${name} 失败`;
  } finally {
    busy.value = "";
  }
}
</script>

<template>
  <div>
    <div class="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
      <div><h1 class="text-[19px] font-bold leading-[1.3]">维护工具</h1><p class="mt-1 text-[10.5px] text-muted-foreground">手动触发派生索引、邮件摘要与清理任务。</p></div>
      <p v-if="message" class="text-[10.5px] text-muted-foreground">{{ message }}</p>
    </div>
    <AdminSkeleton v-if="loading" class="mt-4" />
    <div v-else class="mt-3 grid gap-2 sm:grid-cols-2">
      <div v-for="tool in tools" :key="tool.key" class="v2-admin-card flex items-center gap-3">
        <div class="min-w-0 flex-1"><p class="text-[11.5px] font-semibold">{{ tool.name }}</p><p class="mt-0.5 text-[10.5px] leading-5 text-muted-foreground">{{ tool.hint }}</p><p class="mt-0.5 text-[10px] text-muted-foreground">上次运行 {{ jobs[tool.key] ? formatDate(jobs[tool.key]!) : "—" }}</p></div>
        <button type="button" class="v2-btn sm" :disabled="busy === tool.key" @click="run(tool.key, tool.name, tool.run)">{{ busy === tool.key ? "运行中…" : "运行" }}</button>
      </div>
    </div>
    <p class="mt-3 text-[10.5px] leading-5 text-muted-foreground">这些任务只做可重复的派生/清理操作；不会删除主题或回复。</p>
  </div>
</template>
