<script setup lang="ts">
import { ref } from "vue";
import { RouterLink } from "vue-router";
import AuthShell from "@/components/AuthShell.vue";
import { Button } from "@/components/ui/button";
import { ApiClientError, api } from "@/lib/api";
import { alertErrorClass, alertInfoClass, inputClass, labelClass, linkClass } from "@/lib/ui";

const email = ref("");
const error = ref("");
const sent = ref(false);
const submitting = ref(false);

async function submit(): Promise<void> {
  error.value = "";
  if (!email.value) {
    error.value = "请输入邮箱";
    return;
  }
  submitting.value = true;
  try {
    await api.requestPasswordReset(email.value.trim().toLowerCase());
    sent.value = true;
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? cause.message : "发送失败，请稍后重试";
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <AuthShell title="找回密码" subtitle="如果邮箱存在，我们会发送一封 30 分钟内有效的重置邮件。">
    <div v-if="sent" class="space-y-4">
      <p :class="alertInfoClass">
        如果该邮箱已注册，重置邮件已经发送。请检查收件箱和垃圾箱。
      </p>
      <RouterLink to="/login" :class="linkClass">返回登录</RouterLink>
    </div>

    <form v-else class="space-y-4" @submit.prevent="submit">
      <div>
        <label :class="labelClass" for="forgot-email">邮箱</label>
        <input id="forgot-email" v-model="email" name="email" type="email" spellcheck="false" :class="inputClass" autocomplete="email" placeholder="you@example.com" />
      </div>
      <p v-if="error" :class="alertErrorClass">{{ error }}</p>
      <Button class="w-full" type="submit" :disabled="submitting">
        {{ submitting ? "发送中…" : "发送重置邮件" }}
      </Button>
    </form>

    <template #footer>
      <RouterLink to="/login" :class="linkClass">返回登录</RouterLink>
    </template>
  </AuthShell>
</template>
