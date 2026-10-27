<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import AuthShell from "@/components/AuthShell.vue";
import TurnstileWidget from "@/components/TurnstileWidget.vue";
import { t } from "@/i18n";
import { ApiClientError } from "@/lib/api";
import { alertErrorClass, alertInfoClass, linkClass, mutedLinkClass } from "@/lib/ui";
import { useAuthStore } from "@/stores/auth";
import { useConfigStore } from "@/stores/config";

const auth = useAuthStore();
const config = useConfigStore();
const router = useRouter();

const form = reactive({ name: "", username: "", email: "", password: "", confirm: "" });
const turnstileToken = ref("");
const widget = ref<{ reset(): void; show(): void } | null>(null);
const error = ref("");
const fields = ref<Record<string, string[]>>({});
const submitting = ref(false);

const registrationOpen = computed(() => config.config?.account.registrationOpen ?? true);
const passwordMin = computed(() => Math.max(10, config.config?.account.passwordMinLength ?? 8));
const turnstileEnabled = computed(() => Boolean(config.config?.feature.turnstile && config.turnstileSiteKey));

function suggestUsername(): void {
  if (form.username) return;
  const local = form.email.split("@")[0]?.toLowerCase() ?? "";
  const cleaned = local.replace(/[^a-z0-9_-]/g, "").slice(0, 20);
  if (cleaned.length >= 3) form.username = cleaned;
}

function failMessage(cause: unknown): void {
  if (cause instanceof ApiClientError) {
    error.value = config.describeError(cause, "auth.registerFailed");
    fields.value = cause.fields ?? {};
    if (cause.code === "captcha_failed" || cause.code === "captcha_unavailable") {
      widget.value?.reset();
      turnstileToken.value = "";
    }
  } else {
    error.value = t("auth.registerFailed");
  }
}

async function submit(): Promise<void> {
  error.value = "";
  fields.value = {};
  if (!form.name.trim()) {
    fields.value = { name: [t("auth.errorName")] };
    return;
  }
  if (!form.email.trim()) {
    fields.value = { email: [t("auth.errorEmail")] };
    return;
  }
  if (form.password.length < passwordMin.value) {
    fields.value = { password: [t("auth.errorPassword", { n: passwordMin.value })] };
    return;
  }
  if (form.password !== form.confirm) {
    fields.value = { confirm: [t("auth.errorPasswordMismatch")] };
    return;
  }
  if (turnstileEnabled.value && !turnstileToken.value) {
    widget.value?.show();
    error.value = t("auth.captchaRequired");
    return;
  }
  submitting.value = true;
  try {
    await auth.signUp({
      email: form.email,
      password: form.password,
      name: form.name,
      username: form.username,
      turnstileToken: turnstileToken.value,
    });
    await router.push({ name: "me", query: { registered: "1" } });
  } catch (cause) {
    failMessage(cause);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <AuthShell :title="t('auth.registerTitle')" :subtitle="t('auth.registerSubtitle')">
    <div v-if="!registrationOpen" :class="alertInfoClass">
      {{ t("auth.registrationClosed") }}
      <RouterLink to="/login" :class="linkClass">{{ t("auth.loginLink") }}</RouterLink>.
    </div>

    <form v-else class="space-y-4" @submit.prevent="submit">
      <div>
        <label class="v2-auth-label" for="register-name">{{ t("auth.nickname") }}</label>
        <input id="register-name" v-model="form.name" name="name" class="v2-input" autocomplete="nickname" :placeholder="t('auth.nicknamePlaceholder')" />
        <p v-if="fields.name" class="mt-1 text-xs text-destructive">{{ fields.name[0] }}</p>
      </div>
      <div>
        <label class="v2-auth-label" for="register-username">{{ t("auth.username") }}</label>
        <input
          id="register-username"
          v-model="form.username"
          name="username"
          spellcheck="false"
          class="v2-input"
          autocomplete="username"
          :placeholder="t('auth.usernamePlaceholder')"
          @blur="suggestUsername"
        />
        <p class="mt-1 text-xs text-muted-foreground">{{ t("auth.usernameHint") }}</p>
        <p v-if="fields.username" class="mt-1 text-xs text-destructive">{{ fields.username[0] }}</p>
      </div>
      <div>
        <label class="v2-auth-label" for="register-email">{{ t("auth.email") }}</label>
        <input
          id="register-email"
          v-model="form.email"
          name="email"
          spellcheck="false"
          type="email"
          class="v2-input"
          autocomplete="email"
          :placeholder="t('auth.emailPlaceholder')"
          @blur="suggestUsername"
        />
        <p v-if="fields.email" class="mt-1 text-xs text-destructive">{{ fields.email[0] }}</p>
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <label class="v2-auth-label" for="register-password">{{ t("auth.password") }}</label>
          <input
            id="register-password"
            v-model="form.password"
            name="new-password"
            type="password"
            class="v2-input"
            autocomplete="new-password"
            :placeholder="t('auth.passwordMinPlaceholder', { n: passwordMin })"
          />
          <p v-if="fields.password" class="mt-1 text-xs text-destructive">{{ fields.password[0] }}</p>
        </div>
        <div>
          <label class="v2-auth-label" for="register-confirm">{{ t("auth.passwordConfirm") }}</label>
          <input
            id="register-confirm"
            v-model="form.confirm"
            name="confirm-password"
            type="password"
            class="v2-input"
            autocomplete="new-password"
          />
          <p v-if="fields.confirm" class="mt-1 text-xs text-destructive">{{ fields.confirm[0] }}</p>
        </div>
      </div>

      <div v-if="turnstileEnabled" class="mt-1">
        <TurnstileWidget
          ref="widget"
          :site-key="config.turnstileSiteKey"
          action="signup"
          @token="turnstileToken = $event"
          @expired="turnstileToken = ''"
          @error="error = $event"
        />
      </div>

      <p v-if="error" :class="alertErrorClass">{{ error }}</p>
      <button type="submit" class="v2-auth-submit" :disabled="submitting">
        {{ submitting ? t("auth.registering") : t("auth.registerButton") }}
      </button>
    </form>

    <template #footer>
      {{ t("auth.haveAccount") }}
      <RouterLink to="/login" :class="linkClass">{{ t("auth.loginButton") }}</RouterLink>
      <span class="mx-2 text-line">·</span>
      <RouterLink to="/" :class="mutedLinkClass">{{ t("auth.backHome") }}</RouterLink>
    </template>
  </AuthShell>
</template>
