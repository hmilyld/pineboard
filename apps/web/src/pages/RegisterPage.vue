<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import AuthShell from "@/components/AuthShell.vue";
import TurnstileWidget from "@/components/TurnstileWidget.vue";
import { Button } from "@/components/ui/button";
import { ApiClientError } from "@/lib/api";
import { alertErrorClass, alertInfoClass, inputClass, labelClass, linkClass, mutedLinkClass } from "@/lib/ui";
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
    error.value = cause.message;
    fields.value = cause.fields ?? {};
    if (cause.code === "captcha_failed" || cause.code === "captcha_unavailable") {
      widget.value?.reset();
      turnstileToken.value = "";
    }
  } else {
    error.value = "注册失败，请稍后重试";
  }
}

async function submit(): Promise<void> {
  error.value = "";
  fields.value = {};
  if (!form.name.trim()) {
    fields.value = { name: ["请输入昵称"] };
    return;
  }
  if (!form.email.trim()) {
    fields.value = { email: ["请输入邮箱"] };
    return;
  }
  if (form.password.length < passwordMin.value) {
    fields.value = { password: [`密码至少 ${passwordMin.value} 位`] };
    return;
  }
  if (form.password !== form.confirm) {
    fields.value = { confirm: ["两次输入的密码不一致"] };
    return;
  }
  if (turnstileEnabled.value && !turnstileToken.value) {
    widget.value?.show();
    error.value = "请先完成人机验证";
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
  <AuthShell title="创建账户" subtitle="注册后即可登录；写操作需要先验证邮箱。">
    <div v-if="!registrationOpen" :class="alertInfoClass">
      当前未开放注册。已有账户请
      <RouterLink to="/login" :class="linkClass">登录</RouterLink>。
    </div>

    <form v-else class="space-y-4" @submit.prevent="submit">
      <div>
        <label class="v2-auth-label" for="register-name">昵称</label>
        <input id="register-name" v-model="form.name" name="name" class="v2-input" autocomplete="nickname" placeholder="显示名称" />
        <p v-if="fields.name" class="mt-1 text-xs text-destructive">{{ fields.name[0] }}</p>
      </div>
      <div>
        <label class="v2-auth-label" for="register-username">用户名</label>
        <input
          id="register-username"
          v-model="form.username"
          name="username"
          spellcheck="false"
          class="v2-input"
          autocomplete="username"
          placeholder="3–20 位小写字母、数字、_ 或 -"
          @blur="suggestUsername"
        />
        <p class="mt-1 text-xs text-muted-foreground">用户名用于 @ 提及，注册后不可修改。</p>
        <p v-if="fields.username" class="mt-1 text-xs text-destructive">{{ fields.username[0] }}</p>
      </div>
      <div>
        <label class="v2-auth-label" for="register-email">邮箱</label>
        <input
          id="register-email"
          v-model="form.email"
          name="email"
          spellcheck="false"
          type="email"
          class="v2-input"
          autocomplete="email"
          placeholder="you@example.com"
          @blur="suggestUsername"
        />
        <p v-if="fields.email" class="mt-1 text-xs text-destructive">{{ fields.email[0] }}</p>
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <label class="v2-auth-label" for="register-password">密码</label>
          <input
            id="register-password"
            v-model="form.password"
            name="new-password"
            type="password"
            class="v2-input"
            autocomplete="new-password"
            :placeholder="`至少 ${passwordMin} 位`"
          />
          <p v-if="fields.password" class="mt-1 text-xs text-destructive">{{ fields.password[0] }}</p>
        </div>
        <div>
          <label class="v2-auth-label" for="register-confirm">确认密码</label>
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
        {{ submitting ? "创建中…" : "创建账户" }}
      </button>
    </form>

    <template #footer>
      已有账户？
      <RouterLink to="/login" :class="linkClass">登录</RouterLink>
      <span class="mx-2 text-line">·</span>
      <RouterLink to="/" :class="mutedLinkClass">返回首页</RouterLink>
    </template>
  </AuthShell>
</template>
