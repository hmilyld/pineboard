<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink, useRoute } from "vue-router";
import AuthShell from "@/components/AuthShell.vue";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { alertErrorClass, alertInfoClass, linkClass } from "@/lib/ui";
import { useAuthStore } from "@/stores/auth";
import { useConfigStore } from "@/stores/config";

const route = useRoute();
const auth = useAuthStore();
const config = useConfigStore();
const token = computed(() => (typeof route.query.token === "string" ? route.query.token : ""));
const error = ref("");
const done = ref(false);
const submitting = ref(false);

async function verify(): Promise<void> {
  error.value = "";
  if (!token.value) {
    error.value = t("auth.verifyIncomplete");
    return;
  }
  submitting.value = true;
  try {
    await api.verifyEmail(token.value);
    await auth.refresh();
    done.value = true;
  } catch (cause) {
    error.value = config.describeError(cause, "auth.verifyFailed");
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <AuthShell :title="t('auth.verifyTitle')" :subtitle="t('auth.verifySubtitle')">
    <div v-if="done" class="space-y-4">
      <p :class="alertInfoClass">{{ t("auth.verifyDone") }}</p>
      <div class="flex gap-4 text-sm">
        <RouterLink to="/me" :class="linkClass">{{ t("auth.meCenter") }}</RouterLink>
        <RouterLink to="/" :class="linkClass">{{ t("auth.backHome") }}</RouterLink>
      </div>
    </div>

    <div v-else class="space-y-4">
      <p class="text-sm leading-6 text-muted-foreground">
        {{ t("auth.verifyIntro") }}
      </p>
      <p v-if="error" :class="alertErrorClass">{{ error }}</p>
      <Button class="w-full" :disabled="submitting || !token" @click="verify">
        {{ submitting ? t("auth.verifying") : t("auth.verifyButton") }}
      </Button>
    </div>
  </AuthShell>
</template>
