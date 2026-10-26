<script setup lang="ts">
import { ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import AuthShell from "@/components/AuthShell.vue";
import { Button } from "@/components/ui/button";
import { ApiClientError } from "@/lib/api";
import { alertErrorClass, inputClass, labelClass, linkClass, mutedLinkClass } from "@/lib/ui";
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();
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
    error.value = "请输入邮箱和密码";
    return;
  }
  submitting.value = true;
  try {
    await auth.signIn(email.value, password.value);
    const next = typeof route.query.next === "string" && route.query.next.startsWith("/") ? route.query.next : "/";
    await router.push(next);
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? cause.message : "登录失败，请稍后重试";
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <AuthShell title="登录" subtitle="使用邮箱和密码进入论坛。">
    <form class="space-y-4" @submit.prevent="submit">
      <div>
        <label class="v2-auth-label" for="login-email">邮箱</label>
        <input id="login-email" v-model="email" name="email" type="email" spellcheck="false" autocomplete="email" placeholder="you@example.com" class="v2-input" />
      </div>
      <div>
        <div class="flex items-center justify-between">
          <label class="v2-auth-label" for="login-password">密码</label>
          <button type="button" class="text-[10.5px] text-muted-foreground hover:text-ink" @click="showPassword = !showPassword">{{ showPassword ? "隐藏" : "显示" }}</button>
        </div>
        <input
          id="login-password"
          v-model="password"
          name="password"
          :type="showPassword ? 'text' : 'password'"
          autocomplete="current-password"
          placeholder="输入密码"
          class="v2-input"
        />
      </div>
      <p v-if="error" :class="alertErrorClass">{{ error }}</p>
      <button type="submit" class="v2-auth-submit" :disabled="submitting">
        {{ submitting ? "登录中…" : "登录" }}
      </button>
    </form>

    <div class="mt-2 flex justify-end"><RouterLink to="/forgot-password" class="text-[10.5px] text-muted-foreground hover:text-ink">忘记密码</RouterLink></div>
    <p class="mt-6 text-center text-[11.5px] text-muted-foreground">还没有账户？<RouterLink to="/register" class="text-ink underline underline-offset-2">创建一个</RouterLink></p>
  </AuthShell>
</template>
