<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import AccountShell from "@/components/AccountShell.vue";
import AccountSkeleton from "@/components/AccountSkeleton.vue";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/auth";
import { useConfigStore } from "@/stores/config";
import { alertErrorClass, alertInfoClass, cardClass } from "@/lib/ui";

const profile = computed(() => ({ id: auth.user?.id ?? "", name: auth.user?.name ?? "", username: auth.user?.username ?? null, role: auth.user?.role ?? "user", bio: auth.user?.bio ?? null, createdAt: auth.user?.createdAt ?? 0 }));
const auth = useAuthStore();
const configStore = useConfigStore();
const labels = computed<Record<string, string>>(() => ({
  topic_reply: t("preferences.topic_reply"),
  post_reply: t("preferences.post_reply"),
  mention: t("preferences.mention"),
  moderation: t("preferences.moderation"),
}));
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
    error.value = configStore.describeError(cause, "common.loadFailed");
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
    saved.value = t("preferences.saved");
  } catch (cause) {
    error.value = configStore.describeError(cause, "common.saveFailed");
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <AccountSkeleton v-if="!auth.user || loading" />
  <AccountShell v-else-if="auth.user" :profile="profile" active="preferences" :topic-count="summary.topicCount" :reply-count="summary.replyCount" :like-count="summary.likeCount" :bookmark-count="summary.bookmarkCount" :notification-count="summary.unreadCount" is-self>
    <div class="v2-section-head"><h2>{{ t("preferences.title") }}</h2><span>{{ t("preferences.subtitle") }}</span></div>
    <p class="mb-3 text-[11.5px] text-muted-foreground">{{ t("preferences.intro") }}</p>
    <p v-if="error" :class="[alertErrorClass, 'mb-3']">{{ error }}</p>
    <p v-if="saved" :class="[alertInfoClass, 'mb-3']">{{ saved }}</p>
    <section class="v2-panel p-4">
      <div class="space-y-3">
        <label v-for="(label, key) in labels" :key="key" class="flex items-start gap-3 text-[12px]">
          <input v-model="email[key]" :name="`email-${key}`" type="checkbox" class="mt-0.5 size-4 accent-brand" />
          <span class="font-medium">{{ label }}</span>
        </label>
      </div>
      <div class="mt-5"><Button :disabled="saving" @click="save">{{ saving ? t("common.saving") : t("preferences.save") }}</Button></div>
    </section>
  </AccountShell>
</template>
