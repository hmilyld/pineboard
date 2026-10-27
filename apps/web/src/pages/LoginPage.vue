<script setup lang="ts">
import { ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import AuthShell from "@/components/AuthShell.vue";
import { t } from "@/i18n";
import { alertErrorClass } from "@/lib/ui";
import { useConfigStore } from "@/stores/config";
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();
const config = useConfigStore();
const router = useRouter();
const route = useRoute();
const email = ref("");
const password = ref("");
const error = ref("");
const showPassword = ref(false);
const submitting = ref(false);

async function submit(): Promise<void> {
  error.value = "";
  if (!email.value || !password.value) {
    error.value = t("auth.emailPasswordRequired");
    return;
  }
  submitting.value = true;
  try {
    await auth.signIn(email.value, password.value);
    const next = typeof route.query.next === "string" && route.query.next.startsWith("/") ? route.query.next : "/";
    await router.push(next);
  } catch (cause) {
    error.value = config.describeError(cause, "auth.loginFailed");
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <AuthShell :title="t('auth.loginTitle')" :subtitle="t('auth.loginSubtitle')">
    <form class="space-y-4" @submit.prevent="submit">
      <div>
        <label class="v2-auth-label" for="login-email">{{ t("auth.email") }}</label>
        <input id="login-email" v-model="email" name="email" type="email" spellcheck="false" autocomplete="email" :placeholder="t('auth.emailPlaceholder')" class="v2-input" />
      </div>
      <div>
        <div class="flex items-center justify-between">
          <label class="v2-auth-label" for="login-password">{{ t("auth.password") }}</label>
          <button type="button" class="text-[10.5px] text-muted-foreground hover:text-ink" @click="showPassword = !showPassword">{{ showPassword ? t("auth.passwordHide") : t("auth.passwordShow") }}</button>
        </div>
        <input
          id="login-password"
          v-model="password"
          name="password"
          :type="showPassword ? 'text' : 'password'"
          autocomplete="current-password"
          :placeholder="t('auth.passwordPlaceholder')"
          class="v2-input"
        />
      </div>
      <p v-if="error" :class="alertErrorClass">{{ error }}</p>
      <button type="submit" class="v2-auth-submit" :disabled="submitting">
        {{ submitting ? t("auth.loggingIn") : t("auth.loginButton") }}
      </button>
    </form>

    <div class="mt-2 flex justify-end"><RouterLink to="/forgot-password" class="text-[10.5px] text-muted-foreground hover:text-ink">{{ t("auth.forgotPassword") }}</RouterLink></div>
    <p class="mt-6 text-center text-[11.5px] text-muted-foreground">{{ t("auth.noAccount") }} <RouterLink to="/register" class="text-ink underline underline-offset-2">{{ t("auth.createOne") }}</RouterLink></p>
  </AuthShell>
</template>
