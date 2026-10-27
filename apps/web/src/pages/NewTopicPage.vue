<script setup lang="ts">
import type { Category, Tag } from "@pineboard/shared";
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import MarkdownEditor from "@/components/MarkdownEditor.vue";
import PageSkeleton from "@/components/PageSkeleton.vue";
import TurnstileWidget from "@/components/TurnstileWidget.vue";
import { api } from "@/lib/api";
import { intlLocale, t } from "@/i18n";
import { withSkeletonDelay } from "@/lib/ui";
import { categoryClass, categoryStyle } from "@/lib/category";
import { useAuthStore } from "@/stores/auth";
import { useConfigStore } from "@/stores/config";

const auth = useAuthStore();
const config = useConfigStore();
const route = useRoute();
const router = useRouter();
const DRAFT_KEY = "draft:new-topic";

const categories = ref<Category[]>([]);
const tags = ref<Tag[]>([]);
const form = reactive({ categoryId: "", title: "", contentMd: "", tagIds: [] as string[] });
const token = ref("");
const widget = ref<{ reset(): void; show(): void } | null>(null);
const fields = ref<Record<string, string[]>>({});
const error = ref("");
const loading = ref(true);
const submitting = ref(false);
const resending = ref(false);
const sent = ref(false);
const draftAt = ref<number | null>(null);
const draftAvailable = ref(false);
let draftTimer: number | undefined;
let completed = false;

const turnstileEnabled = computed(() => Boolean(config.config?.feature.turnstile && config.turnstileSiteKey));
const canPublish = computed(() => Boolean(auth.user && auth.permissions?.canWrite));
const selectedTags = computed(() => tags.value.filter((tag) => form.tagIds.includes(tag.id)));
const draftLabel = computed(() => (draftAt.value ? new Intl.DateTimeFormat(intlLocale(), { hour: "2-digit", minute: "2-digit" }).format(new Date(draftAt.value)) : ""));

function toggleTag(id: string): void {
  if (form.tagIds.includes(id)) form.tagIds = form.tagIds.filter((tag) => tag !== id);
  else if (form.tagIds.length < 5) form.tagIds.push(id);
}

function restoreDraft(): void {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    const draft = JSON.parse(raw) as { categoryId?: string; title?: string; contentMd?: string; tagIds?: string[]; savedAt?: number };
    form.categoryId = draft.categoryId || form.categoryId;
    form.title = draft.title ?? "";
    form.contentMd = draft.contentMd ?? "";
    form.tagIds = Array.isArray(draft.tagIds) ? draft.tagIds.slice(0, 5) : [];
    draftAt.value = draft.savedAt ?? null;
    draftAvailable.value = false;
  } catch {
    localStorage.removeItem(DRAFT_KEY);
  }
}

function clearDraft(): void {
  localStorage.removeItem(DRAFT_KEY);
  draftAt.value = null;
  draftAvailable.value = false;
}

function saveDraft(): void {
  if (!form.title.trim() && !form.contentMd.trim()) return;
  const savedAt = Date.now();
  localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...form, savedAt }));
  draftAt.value = savedAt;
}

function scheduleDraft(): void {
  window.clearTimeout(draftTimer);
  draftTimer = window.setTimeout(saveDraft, 800);
}

watch(form, scheduleDraft, { deep: true });

async function submit(): Promise<void> {
  error.value = "";
  fields.value = {};
  if (!form.categoryId) fields.value.categoryId = [t("newTopic.categoryRequired")];
  if (!form.title.trim()) fields.value.title = [t("newTopic.titleRequired")];
  if (!form.contentMd.trim()) fields.value.contentMd = [t("newTopic.contentRequired")];
  if (Object.keys(fields.value).length) return;
  if (turnstileEnabled.value && !token.value) {
    widget.value?.show();
    error.value = t("auth.captchaRequired");
    return;
  }
  submitting.value = true;
  try {
    const result = await api.createTopic(
      { categoryId: form.categoryId, title: form.title.trim(), contentMd: form.contentMd, tagIds: form.tagIds },
      token.value,
    );
    completed = true;
    clearDraft();
    await router.push(`/t/${result.id}`);
  } catch (cause) {
    error.value = config.describeError(cause, "newTopic.publishFailed");
    if (cause && typeof cause === "object" && "fields" in cause) {
      fields.value = (cause as { fields?: Record<string, string[]> }).fields ?? {};
    }
    const code = cause && typeof cause === "object" && "code" in cause ? String((cause as { code: unknown }).code) : "";
    if (code === "captcha_failed" || code === "captcha_unavailable") {
      widget.value?.reset();
      token.value = "";
    }
  } finally {
    submitting.value = false;
  }
}

async function resend(): Promise<void> {
  resending.value = true;
  error.value = "";
  try {
    await api.resendVerification();
    sent.value = true;
  } catch (cause) {
    error.value = config.describeError(cause, "topic.failed");
  } finally {
    resending.value = false;
  }
}

onMounted(async () => {
  await config.load();
  try {
    const [categoryData, tagData] = await withSkeletonDelay(Promise.all([api.categories(), api.tags()]));
    categories.value = categoryData;
    tags.value = tagData;
    const queryCategory = typeof route.query.category === "string" ? route.query.category : "";
    form.categoryId = categoryData.find((item) => item.slug === queryCategory)?.id ?? categoryData[0]?.id ?? "";
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) {
      try {
        const draft = JSON.parse(raw) as { title?: string; contentMd?: string };
        draftAvailable.value = Boolean(draft.title?.trim() || draft.contentMd?.trim());
      } catch { /* ignore corrupt draft */ }
    }
  } catch (cause) {
    error.value = config.describeError(cause, "newTopic.loadFailed");
  } finally {
    loading.value = false;
  }
});

onBeforeUnmount(() => {
  window.clearTimeout(draftTimer);
  if (!completed) saveDraft();
});
</script>

<template>
  <main class="v2-page">
    <PageSkeleton v-if="loading" variant="form" narrow />
    <div v-else class="v2-container">
      <div class="flex items-end justify-between gap-4">
        <h1 class="text-[20px] font-bold leading-[1.3]">{{ t("newTopic.title") }}</h1>
        <span class="text-[10.5px] text-muted-foreground">{{ draftAt ? t("newTopic.draftSaved", { time: draftLabel }) : t("newTopic.draftLocal") }}</span>
      </div>

      <section v-if="!canPublish" class="mt-4 border border-line bg-surface p-5">
        <div class="border-l-[3px] border-l-[var(--amber)] bg-[var(--amber-soft)] px-3 py-2 text-[11px] leading-6">
          {{ t("newTopic.verifyBanner") }}
        </div>
        <h2 class="mt-4 text-[15px] font-semibold">{{ t("newTopic.verifyHeading") }}</h2>
        <p class="mt-1 text-[11.5px] leading-6 text-muted-foreground">{{ t("newTopic.verifyBody", { email: auth.user?.email ?? "" }) }}</p>
        <p v-if="sent" class="mt-2 text-[11px] text-[var(--amber)]">{{ t("newTopic.verifySent") }}</p>
        <div class="mt-3 flex gap-2"><button type="button" class="v2-btn solid" :disabled="resending" @click="resend">{{ resending ? t("common.sending") : t("newTopic.resend") }}</button><RouterLink to="/" class="v2-btn">{{ t("newTopic.backHome") }}</RouterLink></div>
      </section>

      <template v-else>
        <div v-if="draftAvailable" class="mt-3 flex items-center gap-3 border border-line bg-surface px-3 py-2 text-[11px] text-muted-foreground">
          {{ t("newTopic.draftFound") }}<button type="button" class="text-pine underline underline-offset-2" @click="restoreDraft">{{ t("newTopic.restoreDraft") }}</button><button type="button" class="ml-auto hover:text-ink" @click="clearDraft">{{ t("newTopic.clearDraft") }}</button>
        </div>

        <form class="mt-4" @submit.prevent="submit" @keydown.ctrl.enter.prevent="submit" @keydown.meta.enter.prevent="submit">
          <div class="flex flex-wrap items-center gap-2 text-[10.5px] text-muted-foreground">
            <span>{{ t("newTopic.postTo") }}</span>
            <button v-for="category in categories" :key="category.id" type="button" class="inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11.5px]" :class="form.categoryId === category.id ? 'border-pine bg-pine-soft text-ink' : 'border-line text-muted-foreground'" @click="form.categoryId = category.id">
              <i class="size-1.5 rounded-full" :class="categoryClass(category.slug)" :style="{ ...categoryStyle(category.color), background: 'var(--c)' }" />{{ category.name }}
            </button>
          </div>
          <p v-if="fields.categoryId" class="mt-1 text-[11px] text-[var(--orange)]">{{ fields.categoryId[0] }}</p>

          <div class="mt-3 overflow-hidden rounded-[6px] border border-line bg-surface">
            <div class="flex h-[58px] items-center border-b border-line px-3">
              <input v-model="form.title" name="title" class="min-w-0 flex-1 border-0 bg-transparent text-[19px] font-semibold outline-none placeholder:text-muted-foreground/60" maxlength="120" :placeholder="t('newTopic.titlePlaceholder')" :aria-label="t('newTopic.titleLabel')" />
              <span class="num text-[10.5px] text-muted-foreground">{{ form.title.length }}/120</span>
            </div>
            <MarkdownEditor v-model="form.contentMd" flat :rows="12" :height="252" :placeholder="t('newTopic.contentPlaceholder')" />
            <div class="border-t border-line px-3 py-2">
              <div class="flex items-center gap-2 text-[10.5px] text-muted-foreground"><span>{{ t("newTopic.tags") }} {{ t("newTopic.tagsMax") }}</span><span class="ml-auto num">{{ form.tagIds.length }} / 5</span></div>
              <div class="mt-1.5 flex flex-wrap gap-1.5">
                <button v-for="tag in tags" :key="tag.id" type="button" class="h-[26px] rounded-full border px-2.5 text-[11px]" :class="form.tagIds.includes(tag.id) ? 'border-pine bg-pine-soft text-ink' : 'border-line text-muted-foreground'" :disabled="!form.tagIds.includes(tag.id) && form.tagIds.length >= 5" @click="toggleTag(tag.id)">#{{ tag.name }}</button>
              </div>
            </div>
          </div>
          <p v-if="fields.title" class="mt-1 text-[11px] text-[var(--orange)]">{{ fields.title[0] }}</p>
          <p v-if="fields.contentMd" class="mt-1 text-[11px] text-[var(--orange)]">{{ fields.contentMd[0] }}</p>

          <div v-if="turnstileEnabled" class="mt-2">
            <TurnstileWidget ref="widget" :site-key="config.turnstileSiteKey" action="topic_create" @token="token = $event" @expired="token = ''" @error="error = $event" />
          </div>

          <p v-if="error" class="v2-alert mt-3" role="alert">{{ error }}</p>
          <div class="mt-4 flex items-center gap-3">
            <span class="text-[10px] leading-5 text-muted-foreground">{{ t("newTopic.footerHint") }}</span>
            <span class="ml-auto" />
            <RouterLink to="/" class="v2-btn">{{ t("newTopic.cancel") }}</RouterLink>
            <button type="submit" class="v2-btn solid" :disabled="submitting">{{ submitting ? t("newTopic.publishing") : t("newTopic.publish") }}</button>
          </div>
        </form>
      </template>
    </div>
  </main>
</template>
