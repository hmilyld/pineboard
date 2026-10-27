<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRoute } from "vue-router";
import BrandMark from "@/components/BrandMark.vue";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { useConfigStore } from "@/stores/config";
import { alertErrorClass, alertInfoClass, linkClass } from "@/lib/ui";

const route = useRoute();
const config = useConfigStore();
const token = computed(() => (typeof route.query.token === "string" ? route.query.token : ""));
const preview = ref<{ email: string; category: string; valid: boolean } | null>(null);
const error = ref("");
const done = ref(false);
const submitting = ref(false);

/** Email categories come from the API; unknown values fall back to the raw code. */
function categoryLabel(category: string): string {
  const known = ["topic_reply", "post_reply", "mention", "moderation"] as const;
  const match = known.find((item) => item === category);
  return match ? t(`preferences.${match}`) : category;
}

onMounted(async () => {
  if (!token.value) {
    error.value = t("unsubscribe.incomplete");
    return;
  }
  try {
    preview.value = await api.unsubscribePreview(token.value);
  } catch (cause) {
    error.value = config.describeError(cause, "unsubscribe.invalid");
  }
});

async function confirm(): Promise<void> {
  submitting.value = true;
  error.value = "";
  try {
    await api.unsubscribe(token.value);
    done.value = true;
  } catch (cause) {
    error.value = config.describeError(cause, "unsubscribe.failed");
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <main class="flex min-h-dvh items-center justify-center bg-page px-4 py-10">
    <div class="w-full max-w-[420px] border border-line bg-surface p-6">
      <div class="flex items-center gap-2"><BrandMark :size="18" :show-name="false" /><span class="text-[15px] font-bold">{{ config.siteName }}</span></div>
      <h1 class="mt-5 text-[20px] font-bold leading-[1.3]">{{ t("unsubscribe.title") }}</h1>
      <template v-if="done">
        <p :class="[alertInfoClass, 'mt-4']">{{ t("unsubscribe.done") }}</p>
        <RouterLink to="/" :class="[linkClass, 'mt-4 inline-block text-[12px]']">{{ t("auth.backHome") }}</RouterLink>
      </template>
      <template v-else-if="preview">
        <p class="mt-2 text-[11.5px] leading-6 text-muted-foreground">{{ t("unsubscribe.confirmPrefix") }}<strong class="text-ink">{{ preview.email }}</strong>{{ t("unsubscribe.confirmMiddle") }}{{ categoryLabel(preview.category) }}{{ t("unsubscribe.confirmSuffix") }}</p>
        <p v-if="error" :class="[alertErrorClass, 'mt-3']">{{ error }}</p>
        <div class="mt-5 flex gap-2"><button type="button" class="v2-btn solid flex-1" :disabled="submitting" @click="confirm">{{ submitting ? t("common.working") : t("unsubscribe.confirm") }}</button><RouterLink to="/" class="v2-btn">{{ t("common.cancel") }}</RouterLink></div>
      </template>
      <p v-else-if="error" :class="[alertErrorClass, 'mt-4']">{{ error }}</p>
      <div v-else class="mt-4 space-y-3">
        <div class="h-3 w-3/4 animate-pulse bg-muted" />
        <div class="h-3 w-1/2 animate-pulse bg-muted" />
        <div class="h-9 w-full animate-pulse bg-muted" />
      </div>
    </div>
  </main>
</template>
