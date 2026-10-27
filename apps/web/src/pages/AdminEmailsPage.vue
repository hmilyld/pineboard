<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import AdminSkeleton from "@/components/AdminSkeleton.vue";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { alertErrorClass, alertInfoClass } from "@/lib/ui";
import { formatDate } from "@/lib/time";
import { useConfigStore } from "@/stores/config";

type EmailLog = { id: string; toEmail: string; category: string; template: string; status: string; errorCode: string | null; errorMessage: string | null; createdAt: number };
const config = useConfigStore();
const logs = ref<EmailLog[]>([]);
const status = ref("all");
const filtered = computed(() => status.value === "all" ? logs.value : logs.value.filter((log) => log.status === status.value));
const loading = ref(true);
const error = ref("");
const message = ref("");
const running = ref(false);

const statusLabel = (value: string): string => {
  if (value === "sent") return t("admin.emails.statusSent");
  if (value === "skipped") return t("admin.emails.statusSkipped");
  if (value === "failed") return t("admin.emails.statusFailed");
  return value;
};

const categoryLabel = (value: string): string => {
  const known = ["topic_reply", "post_reply", "mention", "moderation", "digest", "verification", "reset"];
  const match = known.find((item) => item === value);
  if (!match) return value;
  if (match === "verification") return t("admin.emails.categoryVerification");
  if (match === "reset") return t("admin.emails.categoryReset");
  if (match === "digest") return t("admin.emails.categoryDigest");
  return t(`preferences.${match}` as "preferences.topic_reply");
};

async function load(): Promise<void> {
  loading.value = true;
  try {
    logs.value = (await api.adminEmails()) as unknown as EmailLog[];
  } catch (cause) {
    error.value = config.describeError(cause, "common.loadFailed");
  } finally {
    loading.value = false;
  }
}

async function runDigest(): Promise<void> {
  running.value = true;
  message.value = "";
  try {
    const result = await api.runDigest();
    message.value = t("admin.emails.digestDone", { users: result.users, sent: result.sent, skipped: result.skipped, failed: result.failed, remaining: result.remaining });
    await load();
  } catch (cause) {
    error.value = config.describeError(cause, "admin.emails.runFailed");
  } finally {
    running.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
      <div><h1 class="text-[19px] font-bold leading-[1.3]">{{ t("admin.nav.emails") }}</h1><p class="mt-1 text-[10.5px] text-muted-foreground">{{ t("admin.emails.subtitle") }}</p></div>
      <div class="v2-inline-controls text-[11.5px]"><select v-model="status" class="v2-input w-24 px-2 text-[11.5px]" :aria-label="t('admin.emails.statusLabel')"><option value="all">{{ t("admin.emails.statusAll") }}</option><option value="sent">{{ t("admin.emails.statusSent") }}</option><option value="skipped">{{ t("admin.emails.statusSkipped") }}</option><option value="failed">{{ t("admin.emails.statusFailed") }}</option></select><RouterLink to="/admin/settings" class="text-muted-foreground hover:text-ink">{{ t("admin.nav.settings") }}</RouterLink><button type="button" class="v2-btn sm" :disabled="running" @click="runDigest">{{ running ? t("admin.emails.running") : t("admin.emails.runDigest") }}</button></div>
    </div>

    <p v-if="message" :class="[alertInfoClass, 'mt-6']">{{ message }}</p>
    <p v-if="error" :class="[alertErrorClass, 'mt-6']">{{ error }}</p>
    <AdminSkeleton v-if="loading" class="mt-4" />
    <div v-else class="mt-3 overflow-x-auto border border-line">
      <table class="v2-admin-table min-w-[720px]">
        <thead >
          <tr><th class="p-3">{{ t("admin.emails.colTime") }}</th><th class="p-3">{{ t("admin.emails.colTo") }}</th><th class="p-3">{{ t("admin.emails.colCategory") }}</th><th class="p-3">{{ t("admin.emails.colStatus") }}</th><th class="p-3">{{ t("admin.emails.colError") }}</th></tr>
        </thead>
        <tbody>
          <tr v-for="log in filtered" :key="log.id" >
            <td class="whitespace-nowrap p-3 text-xs text-muted-foreground">{{ formatDate(log.createdAt) }}</td>
            <td class="p-3">{{ log.toEmail }}</td>
            <td class="p-3">{{ categoryLabel(log.category) }}</td>
            <td class="p-3">{{ statusLabel(log.status) }}</td>
            <td class="max-w-xs truncate p-3 text-xs text-destructive">{{ log.errorCode ?? "" }} {{ log.errorMessage ?? "" }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="!filtered.length" class="p-6 text-center text-[11.5px] text-muted-foreground">{{ t("admin.emails.empty") }}</p>
    </div>
  </div>
</template>
