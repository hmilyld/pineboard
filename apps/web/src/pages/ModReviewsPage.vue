<script setup lang="ts">
import { DEFAULT_SENSITIVE_WORDS, type PendingReviewItem } from "@pineboard/shared";
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import AdminSkeleton from "@/components/AdminSkeleton.vue";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/lib/confirm";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { alertErrorClass, alertInfoClass, cardClass, textareaClass } from "@/lib/ui";
import { formatDate } from "@/lib/time";
import { useAuthStore } from "@/stores/auth";
import { useConfigStore } from "@/stores/config";

const config = useConfigStore();
const auth = useAuthStore();
const items = ref<PendingReviewItem[]>([]);
const loading = ref(true);
const error = ref("");
const message = ref("");
const busy = ref("");
const reasons = ref<Record<string, string>>({});

const words = ref("");
const wordsEnabled = ref(true);
const configVersion = ref("0");
const savingWords = ref(false);
const wordsMessage = ref("");

const wordCount = computed(() => words.value.split("\n").map((w) => w.trim()).filter(Boolean).length);
const isAdmin = computed(() => auth.isAdmin);

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    items.value = (await api.pendingReviews()).items;
  } catch (cause) {
    error.value = config.describeError(cause, "common.loadFailed");
  } finally {
    loading.value = false;
  }
}

async function loadWords(): Promise<void> {
  if (!isAdmin.value) return;
  try {
    const data = await api.adminSettings();
    words.value = data.config.security.sensitiveWords.join("\n");
    wordsEnabled.value = data.config.security.sensitiveWordsEnabled;
    configVersion.value = data.version;
  } catch {
    // Moderators cannot read site settings; the queue still works.
  }
}

async function saveWords(nextWords?: string[]): Promise<void> {
  if (savingWords.value) return;
  savingWords.value = true;
  wordsMessage.value = "";
  try {
    const list = nextWords ?? words.value.split("\n").map((w) => w.trim()).filter(Boolean);
    const data = await api.updateAdminSettings(
      { security: { sensitiveWords: list, sensitiveWordsEnabled: wordsEnabled.value } },
      configVersion.value,
    );
    configVersion.value = data.version;
    words.value = data.config.security.sensitiveWords.join("\n");
    wordsMessage.value = t("admin.reviews.wordsSaved");
  } catch (cause) {
    error.value = config.describeError(cause, "common.saveFailed");
  } finally {
    savingWords.value = false;
  }
}

async function decide(item: PendingReviewItem, action: "approve" | "reject"): Promise<void> {
  if (busy.value) return;
  busy.value = item.id;
  error.value = "";
  try {
    await api.decideReview(item.kind, item.id, { action, reason: reasons.value[item.id] || undefined });
    message.value = action === "approve" ? t("admin.reviews.approved") : t("admin.reviews.rejected");
    await load();
  } catch (cause) {
    error.value = config.describeError(cause, "admin.reviews.failed");
  } finally {
    busy.value = "";
  }
}

async function seedDefaults(): Promise<void> {
  const confirmed = await confirmDialog({
    title: t("admin.reviews.seedDefaults"),
    message: t("admin.reviews.seedConfirm"),
    confirmLabel: t("admin.reviews.seedDefaults"),
  });
  if (!confirmed) return;
  await saveWords([...DEFAULT_SENSITIVE_WORDS]);
}

onMounted(async () => {
  await Promise.all([load(), loadWords()]);
});
</script>

<template>
  <div>
    <div class="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
      <div><h1 class="text-[19px] font-bold leading-[1.3]">{{ t("admin.nav.reviews") }}</h1><p class="mt-1 text-[10.5px] text-muted-foreground">{{ t("admin.reviews.subtitle") }}</p></div>
      <RouterLink to="/" class="text-[11.5px] text-muted-foreground hover:text-ink">{{ t("admin.shell.backToForum") }}</RouterLink>
    </div>

    <p v-if="message" :class="[alertInfoClass, 'mt-6']">{{ message }}</p>
    <p v-if="error" :class="[alertErrorClass, 'mt-6']">{{ error }}</p>

    <AdminSkeleton v-if="loading" class="mt-4" />
    <div v-else-if="!items.length" class="empty-state mt-6">{{ t("admin.reviews.empty") }}</div>
    <div v-else class="mt-3 space-y-3">
      <article v-for="item in items" :key="item.id" :class="cardClass">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span class="bg-warning/15 px-1.5 py-0.5 text-warning">{{ item.kind === "topic" ? t("admin.reports.targetTopic") : t("admin.reports.targetPost") }}</span>
          <span>{{ item.authorName }}</span>
          <span>{{ formatDate(item.createdAt) }}</span>
          <span v-if="item.keywords.length" class="text-destructive">{{ t("admin.reviews.keywordHint", { words: item.keywords.join("、") }) }}</span>
        </div>
        <h2 v-if="item.title" class="mt-2 text-sm font-medium">{{ item.title }}</h2>
        <p class="mt-1 line-clamp-4 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{{ item.contentMd }}</p>
        <input v-model="reasons[item.id]" class="v2-input mt-2 h-8" :placeholder="t('admin.reviews.rejectReason')" maxlength="200" :aria-label="t('admin.reviews.rejectReason')" />
        <div class="mt-3 flex gap-2">
          <Button size="sm" :disabled="busy === item.id" @click="decide(item, 'approve')">{{ t("admin.reviews.approve") }}</Button>
          <Button size="sm" variant="outline" :disabled="busy === item.id" @click="decide(item, 'reject')">{{ t("admin.reviews.reject") }}</Button>
        </div>
      </article>
    </div>

    <section v-if="isAdmin" class="mt-10 border-t border-line pt-6">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 class="text-[15px] font-bold">{{ t("admin.reviews.wordsTitle") }}</h2>
          <p class="mt-1 text-[10.5px] text-muted-foreground">{{ t("admin.reviews.wordsSubtitle") }}</p>
        </div>
        <span class="num text-[10.5px] text-muted-foreground">{{ t("admin.reviews.wordsCount", { n: wordCount }) }}</span>
      </div>
      <label class="mt-3 flex items-center gap-2 text-[12px]">
        <input v-model="wordsEnabled" type="checkbox" class="size-3.5" />
        {{ t("admin.reviews.wordsEnabled") }}
      </label>
      <label class="mt-3 block">
        <span class="v2-label">{{ t("admin.reviews.wordsLabel") }}</span>
        <textarea v-model="words" :class="[textareaClass, 'mt-1 min-h-[220px] font-mono text-[12px]']" :placeholder="t('admin.reviews.wordsPlaceholder')" spellcheck="false" />
      </label>
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" :disabled="savingWords" @click="saveWords()">{{ savingWords ? t("common.saving") : t("common.save") }}</Button>
        <Button size="sm" variant="outline" :disabled="savingWords" @click="seedDefaults">{{ t("admin.reviews.seedDefaults") }}</Button>
        <span v-if="wordsMessage" class="text-[11.5px] text-muted-foreground">{{ wordsMessage }}</span>
      </div>
    </section>
  </div>
</template>
