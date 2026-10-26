<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { derivePassword } from "@pineboard/shared";
import AuthShell from "@/components/AuthShell.vue";
import { Button } from "@/components/ui/button";
import { ApiClientError, api } from "@/lib/api";
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

async function submit(): Promise<void> {
  error.value = "";
  if (!token.value || !email.value) {
    error.value = "重置链接不完整，请重新申请";
    return;
  }
  if (password.value.length < (config.config?.account.passwordMinLength ?? 8)) {
    error.value = `密码至少 ${config.config?.account.passwordMinLength ?? 8} 位`;
    return;
  }
  if (password.value !== confirm.value) {
    error.value = "两次输入的密码不一致";
    return;
  }
  submitting.value = true;
  try {
    const derived = await derivePassword(email.value, password.value);
    await api.resetPassword(token.value, derived);
    done.value = true;
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? cause.message : "重置失败，请重新申请";
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <AuthShell title="重置密码" subtitle="设置新密码后，该账户的全部登录会话会失效。">
    <div v-if="done" class="space-y-4">
      <p :class="alertInfoClass">密码已更新，请使用新密码登录。</p>
      <RouterLink to="/login" :class="linkClass">去登录</RouterLink>
    </div>

    <form v-else class="space-y-4" @submit.prevent="submit">
      <div>
        <label :class="labelClass" for="reset-email">邮箱</label>
        <input id="reset-email" :value="email" :class="inputClass" disabled />
        <p class="mt-1 text-xs text-muted-foreground">密码使用邮箱作为派生盐；邮箱不可在此修改。</p>
      </div>
      <div>
        <label :class="labelClass" for="reset-password">新密码</label>
        <input id="reset-password" v-model="password" name="new-password" type="password" :class="inputClass" autocomplete="new-password" />
      </div>
      <div>
        <label :class="labelClass" for="reset-confirm">确认新密码</label>
        <input id="reset-confirm" v-model="confirm" name="confirm-password" type="password" :class="inputClass" autocomplete="new-password" />
      </div>
      <p v-if="error" :class="alertErrorClass">{{ error }}</p>
      <Button class="w-full" type="submit" :disabled="submitting">
        {{ submitting ? "更新中…" : "更新密码" }}
      </Button>
    </form>

    <template #footer>
      <RouterLink to="/forgot-password" :class="linkClass">重新申请</RouterLink>
      <span class="mx-2 text-border">·</span>
      <RouterLink to="/login" :class="linkClass">返回登录</RouterLink>
    </template>
  </AuthShell>
</template>
