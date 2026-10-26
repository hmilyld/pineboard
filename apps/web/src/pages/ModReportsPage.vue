<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import AdminSkeleton from "@/components/AdminSkeleton.vue";
import PaginationBar from "@/components/PaginationBar.vue";
import { Button } from "@/components/ui/button";
import { api, ApiClientError } from "@/lib/api";
import { alertErrorClass, alertInfoClass, cardClass } from "@/lib/ui";
import { formatDate } from "@/lib/time";

type Report = {
  id: string; reporter: { name: string; username: string | null }; targetType: string; targetId: string;
  topicId: string; postId: string | null; targetTitle: string; targetSnippet: string;
  reasonCode: string; detail: string; status: string; createdAt: number;
};
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

const reasonLabels: Record<string, string> = { spam: "垃圾广告", abuse: "辱骂/攻击", illegal: "违法内容", off_topic: "与主题无关", other: "其他" };

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
    error.value = cause instanceof ApiClientError ? cause.message : "加载失败";
  } finally {
    loading.value = false;
  }
}

async function resolve(report: Report, status: "resolved" | "dismissed"): Promise<void> {
  if (busy.value) return;
  busy.value = report.id;
  try {
    await api.resolveReport(report.id, { status, resolutionNote: notes.value[report.id] ?? "" });
    message.value = status === "resolved" ? "举报已标记为已处理。" : "举报已驳回。";
    await load(page.value);
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? cause.message : "处理失败";
  } finally {
    busy.value = "";
  }
}

onMounted(() => load(1));
</script>

<template>
  <div>
    <div class="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
      <div><h1 class="text-[19px] font-bold leading-[1.3]">举报处理</h1><p class="mt-1 text-[10.5px] text-muted-foreground">按创建时间升序，先处理较早的举报。</p></div>
      <RouterLink to="/" class="text-[11.5px] text-muted-foreground hover:text-ink">返回论坛</RouterLink>
    </div>

    <p v-if="message" :class="[alertInfoClass, 'mt-6']">{{ message }}</p>
    <p v-if="error" :class="[alertErrorClass, 'mt-6']">{{ error }}</p>
    <AdminSkeleton v-if="loading" class="mt-4" />
    <div v-else-if="!reports.length" class="empty-state mt-6">
      没有待处理的举报。
    </div>
    <div v-else class="mt-3 space-y-3">
      <article v-for="report in reports" :key="report.id" :class="cardClass">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span class="bg-destructive/10 px-1.5 py-0.5 text-destructive">{{ reasonLabels[report.reasonCode] ?? report.reasonCode }}</span>
          <span>{{ report.targetType === "topic" ? "主题" : "回复" }}</span>
          <span>{{ report.reporter.name }}</span>
          <span>{{ formatDate(report.createdAt) }}</span>
        </div>
        <h2 class="mt-2 text-sm font-medium">
          <RouterLink :to="`/t/${report.topicId}`" class="hover:underline">{{ report.targetTitle }}</RouterLink>
        </h2>
        <p class="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">{{ report.targetSnippet }}</p>
        <p v-if="report.detail" class="mt-2 bg-hover p-2.5 text-[11px] leading-6 text-muted-foreground">举报说明：{{ report.detail }}</p>
        <input v-model="notes[report.id]" class="v2-input mt-2 h-8" placeholder="处理备注（可选）" maxlength="500" aria-label="处理备注" />
        <div class="mt-3 flex gap-2">
          <Button size="sm" :disabled="busy === report.id" @click="resolve(report, 'resolved')">已处理</Button>
          <Button size="sm" variant="outline" :disabled="busy === report.id" @click="resolve(report, 'dismissed')">驳回</Button>
          <RouterLink :to="`/t/${report.topicId}`" class="ml-auto self-center text-xs text-muted-foreground hover:text-foreground">查看内容</RouterLink>
        </div>
      </article>
      <PaginationBar v-if="totalPages > 1" :page="page" :total-pages="totalPages" :total="total" unit="条举报" @change="load" />
    </div>
  </div>
</template>
