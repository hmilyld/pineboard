<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api, ApiClientError } from "@/lib/api";
import AccountShell from "@/components/AccountShell.vue";
import AccountSkeleton from "@/components/AccountSkeleton.vue";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/auth";
import { alertErrorClass, alertInfoClass, cardClass } from "@/lib/ui";

const profile = computed(() => ({ id: auth.user?.id ?? "", name: auth.user?.name ?? "", username: auth.user?.username ?? null, role: auth.user?.role ?? "user", bio: auth.user?.bio ?? null, createdAt: auth.user?.createdAt ?? 0 }));
const labels: Record<string, string> = {
  topic_reply: "主题被回复",
  post_reply: "回复被回复",
  mention: "被 @ 提及",
  moderation: "管理通知",
};
const auth = useAuthStore();
const summary = ref({ topicCount: 0, replyCount: 0, likeCount: 0, bookmarkCount: 0, unreadCount: 0 });
const email = ref<Record<string, boolean>>({});
const loading = ref(true);
const saving = ref(false);
const error = ref("");
const saved = ref("");

async function load(): Promise<void> {
  loading.value = true;
  try {
    const [data, summaryData] = await Promise.all([api.preferences(), api.meSummary()]);
    email.value = data.email;
    summary.value = summaryData;
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? cause.message : "加载失败";
  } finally {
    loading.value = false;
  }
}

async function save(): Promise<void> {
  saving.value = true;
  error.value = "";
  saved.value = "";
  try {
    const data = await api.updatePreferences(email.value);
    email.value = data.email;
    saved.value = "偏好已保存。";
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? cause.message : "保存失败";
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <AccountSkeleton v-if="!auth.user || loading" />
  <AccountShell v-else-if="auth.user" :profile="profile" active="preferences" :topic-count="summary.topicCount" :reply-count="summary.replyCount" :like-count="summary.likeCount" :bookmark-count="summary.bookmarkCount" :notification-count="summary.unreadCount" is-self>
    <div class="v2-section-head"><h2>邮件偏好</h2><span>站内通知始终保留</span></div>
    <p class="mb-3 text-[11.5px] text-muted-foreground">这里只控制是否发送邮件摘要。管理通知不可关闭。</p>
    <p v-if="error" :class="[alertErrorClass, 'mb-3']">{{ error }}</p>
    <p v-if="saved" :class="[alertInfoClass, 'mb-3']">{{ saved }}</p>
    <section class="v2-panel p-4">
      <div class="space-y-3">
        <label v-for="(label, key) in labels" :key="key" class="flex items-start gap-3 text-[12px]">
          <input v-model="email[key]" :name="`email-${key}`" type="checkbox" class="mt-0.5 size-4 accent-brand" :disabled="key === 'moderation'" />
          <span><span class="font-medium">{{ label }}</span><span v-if="key === 'moderation'" class="block text-[10.5px] text-muted-foreground">管理通知不可关闭。</span></span>
        </label>
      </div>
      <div class="mt-5"><Button :disabled="saving" @click="save">{{ saving ? "保存中…" : "保存偏好" }}</Button></div>
    </section>
  </AccountShell>
</template>
