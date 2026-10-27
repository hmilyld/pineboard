<script setup lang="ts">
import type { TopicDetail } from "@pineboard/shared";
import { onMounted, reactive, ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import MarkdownEditor from "@/components/MarkdownEditor.vue";
import PageSkeleton from "@/components/PageSkeleton.vue";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { useConfigStore } from "@/stores/config";
import { alertErrorClass, alertInfoClass, inputClass, labelClass, linkClass, withSkeletonDelay } from "@/lib/ui";

const route = useRoute();
const router = useRouter();
const config = useConfigStore();
const detail = ref<TopicDetail | null>(null);
const form = reactive({ title: "", contentMd: "", reason: "" });
const error = ref("");
const loading = ref(true);
const saving = ref(false);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const data = await withSkeletonDelay(api.topic(String(route.params.id)));
    detail.value = data;
    form.title = data.topic.title;
    form.contentMd = data.firstPost.contentMd;
  } catch (cause) {
    error.value = config.describeError(cause, "common.loadFailed");
  } finally {
    loading.value = false;
  }
}

async function save(): Promise<void> {
  if (!detail.value) return;
  if (!form.title.trim() || !form.contentMd.trim()) {
    error.value = t("editTopic.titleRequired");
    return;
  }
  saving.value = true;
  error.value = "";
  try {
    await api.editTopic(String(route.params.id), {
      version: detail.value.firstPost.version,
      title: form.title.trim(),
      contentMd: form.contentMd,
      reason: form.reason.trim() || undefined,
    });
    await router.push(`/t/${route.params.id}`);
  } catch (cause) {
    error.value = config.describeError(cause, "common.saveFailed");
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <main class="v2-page">
    <div class="v2-container">
      <div class="flex items-end justify-between gap-4"><h1 class="text-[20px] font-bold leading-[1.3]">{{ t("editTopic.title") }}</h1><RouterLink :to="`/t/${route.params.id}`" class="text-[11.5px] text-muted-foreground hover:text-ink">{{ t("editTopic.cancel") }}</RouterLink></div>
      <PageSkeleton v-if="loading" class="mt-4" variant="form" :header="false" narrow bare />
      <p v-else-if="error && !detail" :class="[alertErrorClass, 'mt-4']">{{ error }}</p>
      <p v-else-if="detail && !detail.viewer.canEdit" :class="[alertInfoClass, 'mt-4']">{{ t("editTopic.notEditable") }}</p>
      <form v-else-if="detail" class="mt-4" @submit.prevent="save">
        <div class="overflow-hidden rounded-[6px] border border-line bg-surface">
          <div class="flex h-[58px] items-center border-b border-line px-3">
            <input id="edit-title" v-model="form.title" name="title" class="min-w-0 flex-1 border-0 bg-transparent text-[19px] font-semibold outline-none" maxlength="120" :aria-label="t('editTopic.titleLabel')" />
            <span class="num text-[10.5px] text-muted-foreground">{{ form.title.length }}/120</span>
          </div>
          <MarkdownEditor v-model="form.contentMd" flat :rows="14" :height="360" />
        </div>
        <div class="mt-3"><label class="v2-label" for="edit-reason">{{ t("editTopic.reasonLabel") }}</label><input id="edit-reason" v-model="form.reason" name="reason" class="v2-input" maxlength="200" :placeholder="t('editTopic.reasonPlaceholder')" /></div>
        <p v-if="error" class="v2-alert mt-3">{{ error }}</p>
        <div class="mt-3 flex items-center gap-3"><button type="submit" class="v2-btn solid" :disabled="saving">{{ saving ? t("common.saving") : t("editTopic.save") }}</button><RouterLink :to="`/t/${route.params.id}/history`" class="text-[11.5px] text-muted-foreground hover:text-ink">{{ t("editTopic.viewHistory") }}</RouterLink><span class="ml-auto text-[10.5px] text-muted-foreground">{{ t("editTopic.currentVersion", { version: detail.firstPost.version }) }}</span></div>
      </form>
    </div>
  </main>
</template>
