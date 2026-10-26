<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import AdminSkeleton from "@/components/AdminSkeleton.vue";
import { Button } from "@/components/ui/button";
import { api, ApiClientError } from "@/lib/api";
import { alertErrorClass, alertInfoClass, linkClass } from "@/lib/ui";
import { formatDate } from "@/lib/time";

type EmailLog = { id: string; toEmail: string; category: string; template: string; status: string; errorCode: string | null; errorMessage: string | null; createdAt: number };
const logs = ref<EmailLog[]>([]);
const status = ref("all");
const filtered = computed(() => status.value === "all" ? logs.value : logs.value.filter((log) => log.status === status.value));
const loading = ref(true);
const error = ref("");
const message = ref("");
const running = ref(false);

async function load(): Promise<void> {
  loading.value = true;
  try {
    logs.value = (await api.adminEmails()) as unknown as EmailLog[];
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? cause.message : "加载失败";
  } finally {
    loading.value = false;
  }
}

async function runDigest(): Promise<void> {
  running.value = true;
  message.value = "";
  try {
    const result = await api.runDigest();
    message.value = `摘要任务完成：${result.users} 位用户，sent ${result.sent} / skipped ${result.skipped} / failed ${result.failed}，剩余 ${result.remaining}。`;
    await load();
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? cause.message : "执行失败";
  } finally {
    running.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
      <div><h1 class="text-[19px] font-bold leading-[1.3]">邮件日志</h1><p class="mt-1 text-[10.5px] text-muted-foreground">最近的发送记录与失败原因。</p></div>
      <div class="v2-inline-controls text-[11.5px]"><select v-model="status" class="v2-input w-24 px-2 text-[11.5px]" aria-label="邮件状态"><option value="all">全部状态</option><option value="sent">已发送</option><option value="skipped">已跳过</option><option value="failed">失败</option></select><RouterLink to="/admin/settings" class="text-muted-foreground hover:text-ink">站点设置</RouterLink><button type="button" class="v2-btn sm" :disabled="running" @click="runDigest">{{ running ? "执行中…" : "立即执行摘要" }}</button></div>
    </div>

    <p v-if="message" :class="[alertInfoClass, 'mt-6']">{{ message }}</p>
    <p v-if="error" :class="[alertErrorClass, 'mt-6']">{{ error }}</p>
    <AdminSkeleton v-if="loading" class="mt-4" />
    <div v-else class="mt-3 overflow-x-auto border border-line">
      <table class="v2-admin-table min-w-[720px]">
        <thead >
          <tr><th class="p-3">时间</th><th class="p-3">收件人</th><th class="p-3">类别</th><th class="p-3">状态</th><th class="p-3">错误</th></tr>
        </thead>
        <tbody>
          <tr v-for="log in filtered" :key="log.id" >
            <td class="whitespace-nowrap p-3 text-xs text-muted-foreground">{{ formatDate(log.createdAt) }}</td>
            <td class="p-3">{{ log.toEmail }}</td>
            <td class="p-3">{{ log.category }}</td>
            <td class="p-3">{{ log.status }}</td>
            <td class="max-w-xs truncate p-3 text-xs text-destructive">{{ log.errorCode ?? "" }} {{ log.errorMessage ?? "" }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="!filtered.length" class="p-6 text-center text-[11.5px] text-muted-foreground">没有匹配的邮件记录。</p>
    </div>
  </div>
</template>
