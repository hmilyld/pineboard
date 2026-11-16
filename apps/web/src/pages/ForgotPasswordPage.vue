<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import AuthShell from "@/components/AuthShell.vue";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { alertErrorClass, alertInfoClass, inputClass, labelClass, linkClass } from "@/lib/ui";
import { useConfigStore } from "@/stores/config";

const config = useConfigStore();
const email = ref("");
const error = ref("");
const errorEl = ref<HTMLElement | null>(null);
// On failure, route keyboard and screen-reader focus to the error message so
// the failure is not silent for non-visual users.
watch(error, async (value) => {
  if (value) {
    await nextTick();
    errorEl.value?.focus();
  }
});
const sent = ref(false);
const submitting = ref(false);

async function submit(): Promise<void> {
  error.value = "";
  if (!email.value) {
    error.value = t("auth.forgotEmailRequired");
    return;
  }
  submitting.value = true;
  try {
    await api.requestPasswordReset(email.value.trim().toLowerCase());
    sent.value = true;
  } catch (cause) {
    error.value = config.describeError(cause, "auth.forgotFailed");
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <AuthShell :title="t('auth.forgotTitle')" :subtitle="t('auth.forgotSubtitle')">
    <div v-if="sent" class="space-y-4">
      <p :class="alertInfoClass">
        {{ t("auth.forgotSent") }}
      </p>
      <RouterLink to="/login" :class="linkClass">{{ t("auth.backToLogin") }}</RouterLink>
    </div>

    <form v-else class="space-y-4" @submit.prevent="submit">
      <div>
        <label :class="labelClass" for="forgot-email">{{ t("auth.email") }}</label>
        <input id="forgot-email" v-model="email" name="email" type="email" spellcheck="false" autocapitalize="none" enterkeyhint="next" :class="inputClass" autocomplete="email" :placeholder="t('auth.emailPlaceholder')" />
      </div>
      <p v-if="error" ref="errorEl" tabindex="-1" :class="alertErrorClass" role="alert">{{ error }}</p>
      <Button class="w-full" type="submit" :disabled="submitting">
        {{ submitting ? t("common.sending") : t("auth.sendReset") }}
      </Button>
    </form>

    <template #footer>
      <RouterLink to="/login" :class="linkClass">{{ t("auth.backToLogin") }}</RouterLink>
    </template>
  </AuthShell>
</template>
