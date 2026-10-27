<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { derivePassword } from "@pineboard/shared";
import AuthShell from "@/components/AuthShell.vue";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { alertErrorClass, alertInfoClass, inputClass, labelClass, linkClass } from "@/lib/ui";
import { useConfigStore } from "@/stores/config";

const route = useRoute();
const config = useConfigStore();
const token = computed(() => (typeof route.query.token === "string" ? route.query.token : ""));
const email = computed(() => (typeof route.query.email === "string" ? route.query.email : ""));
const password = ref("");
const confirm = ref("");
const error = ref("");
const done = ref(false);
const submitting = ref(false);
const passwordMin = computed(() => config.config?.account.passwordMinLength ?? 8);

async function submit(): Promise<void> {
  error.value = "";
  if (!token.value || !email.value) {
    error.value = t("auth.resetIncomplete");
    return;
  }
  if (password.value.length < passwordMin.value) {
    error.value = t("auth.errorPassword", { n: passwordMin.value });
    return;
  }
  if (password.value !== confirm.value) {
    error.value = t("auth.errorPasswordMismatch");
    return;
  }
  submitting.value = true;
  try {
    const derived = await derivePassword(email.value, password.value);
    await api.resetPassword(token.value, derived);
    done.value = true;
  } catch (cause) {
    error.value = config.describeError(cause, "auth.resetFailed");
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <AuthShell :title="t('auth.resetTitle')" :subtitle="t('auth.resetSubtitle')">
    <div v-if="done" class="space-y-4">
      <p :class="alertInfoClass">{{ t("auth.resetDone") }}</p>
      <RouterLink to="/login" :class="linkClass">{{ t("auth.goLogin") }}</RouterLink>
    </div>

    <form v-else class="space-y-4" @submit.prevent="submit">
      <div>
        <label :class="labelClass" for="reset-email">{{ t("auth.email") }}</label>
        <input id="reset-email" :value="email" :class="inputClass" disabled />
        <p class="mt-1 text-xs text-muted-foreground">{{ t("auth.resetEmailHint") }}</p>
      </div>
      <div>
        <label :class="labelClass" for="reset-password">{{ t("auth.newPassword") }}</label>
        <input id="reset-password" v-model="password" name="new-password" type="password" :class="inputClass" autocomplete="new-password" />
      </div>
      <div>
        <label :class="labelClass" for="reset-confirm">{{ t("auth.passwordConfirm") }}</label>
        <input id="reset-confirm" v-model="confirm" name="confirm-password" type="password" :class="inputClass" autocomplete="new-password" />
      </div>
      <p v-if="error" :class="alertErrorClass">{{ error }}</p>
      <Button class="w-full" type="submit" :disabled="submitting">
        {{ submitting ? t("auth.updating") : t("auth.updatePassword") }}
      </Button>
    </form>

    <template #footer>
      <RouterLink to="/forgot-password" :class="linkClass">{{ t("auth.reapply") }}</RouterLink>
      <span class="mx-2 text-border">·</span>
      <RouterLink to="/login" :class="linkClass">{{ t("auth.backToLogin") }}</RouterLink>
    </template>
  </AuthShell>
</template>
