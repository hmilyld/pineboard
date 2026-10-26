<script setup lang="ts">
import type { AdminOverview } from "@pineboard/shared";
import { confirmDialog } from "@/lib/confirm";
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import AdminSkeleton from "@/components/AdminSkeleton.vue";
import ErrorState from "@/components/ErrorState.vue";
import { api, ApiClientError } from "@/lib/api";
import { formatDate } from "@/lib/time";

const data = ref<AdminOverview | null>(null);
const error = ref("");
const busy = ref("");
const message = ref("");

const tools = [
  { key: "reindex", name: "重建搜索索引", hint: "从 posts 重写 FTS 派生索引", run: () => api.reindexSearch() },
  { key: "digest", name: "立即执行邮件摘要", hint: "处理待发通知，受日预算限制", run: () => api.runDigest() },
  { key: "daily", name: "每日清理与对账", hint: "清理过期数据并重算计数", run: () => api.runDailyMaintenance() },
  { key: "cleanup", name: "注销账户清理", hint: "匿名化已过冷静期的账户", run: () => api.runAccountCleanup() },
];

async function load(): Promise<void> {
  try {
    data.value = await api.adminOverview();
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? cause.message : "加载失败";
  }
}

async function run(key: string, name: string, run: () => Promise<unknown>): Promise<void> {
  if (!(await confirmDialog({ title: name, message: "此操作会立即改变线上数据。", confirmLabel: "执行" }))) return;
  busy.value = key;
  message.value = "";
  try {
    await run();
    message.value = `${name} 已完成。`;
    await load();
  } catch (cause) {
    message.value = cause instanceof ApiClientError ? cause.message : `${name} 失败`;
  } finally {
    busy.value = "";
  }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
      <div><h1 class="text-[19px] font-bold leading-[1.3]">概览</h1><p class="mt-1 text-[10.5px] text-muted-foreground">站点的当日状态与待办。</p></div>
      <p class="text-[10.5px] text-muted-foreground">配置 v{{ data?.configVersion ?? "—" }}<span class="mx-1">·</span>最后部署 {{ data?.lastDeployAt ? formatDate(data.lastDeployAt) : "—" }}</p>
    </div>
    <ErrorState v-if="error" class="mt-4" :message="error" retry @retry="load" />
    <AdminSkeleton v-else-if="!data" class="mt-4" />
    <template v-else>
      <div class="v2-admin-grid mt-3">
        <div class="v2-admin-card"><b>{{ data?.todayPosts ?? 0 }}</b><span>今日发帖</span></div>
        <div class="v2-admin-card"><b :class="data?.pendingReports ? '!text-[var(--orange)]' : ''">{{ data?.pendingReports ?? 0 }}</b><span>待处理举报</span></div>
        <div class="v2-admin-card"><b>{{ data?.newMembersWeek ?? 0 }}</b><span>本周新增成员</span></div>
        <div class="v2-admin-card"><b :class="data?.emailFailures ? '!text-[var(--orange)]' : ''">{{ data?.emailFailures ?? 0 }}</b><span>邮件失败（7 天）</span></div>
      </div>

      <section class="v2-admin-panel mt-4">
        <div class="v2-admin-panel-head"><span>待处理举报</span><RouterLink to="/admin/reports" class="text-[10.5px] text-muted-foreground hover:text-ink">全部 →</RouterLink></div>
        <div v-if="data?.pendingReportItems.length">
          <div v-for="item in data.pendingReportItems" :key="item.id" class="v2-admin-row">
            <div class="min-w-0"><p class="truncate text-[12.5px] font-semibold">{{ item.targetTitle }}</p><p class="mt-0.5 text-[10.5px] text-muted-foreground"><span class="mr-2 inline-block bg-[var(--amber-soft)] px-1 text-[var(--amber)]">{{ item.reasonCode }}</span>{{ item.reporterName }} · {{ formatDate(item.createdAt) }}</p></div>
            <RouterLink to="/admin/reports" class="v2-btn sm">查看</RouterLink>
          </div>
        </div>
        <p v-else class="p-6 text-center text-[11.5px] text-muted-foreground">没有待处理举报。</p>
      </section>

      <section class="mt-4">
        <div class="mb-2 flex items-center justify-between"><h2 class="text-[12px] font-semibold">维护工具</h2><p v-if="message" class="text-[10.5px] text-muted-foreground">{{ message }}</p></div>
        <div class="grid gap-2 sm:grid-cols-2">
          <div v-for="tool in tools" :key="tool.key" class="v2-admin-card flex items-center gap-3">
            <div class="min-w-0 flex-1"><p class="text-[11.5px] font-semibold">{{ tool.name }}</p><p class="mt-0.5 text-[10.5px] text-muted-foreground">{{ tool.hint }}</p><p class="mt-0.5 text-[10px] text-muted-foreground">上次运行 {{ data?.jobs?.[tool.key] ? formatDate(data.jobs[tool.key]!) : "—" }}</p></div>
            <button type="button" class="v2-btn sm" :disabled="busy === tool.key" @click="run(tool.key, tool.name, tool.run)">{{ busy === tool.key ? "运行中…" : "运行" }}</button>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>
