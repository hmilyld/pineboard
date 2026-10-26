<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink, useRoute } from "vue-router";
import AuthShell from "@/components/AuthShell.vue";
import { Button } from "@/components/ui/button";
import { ApiClientError, api } from "@/lib/api";
import { alertErrorClass, alertInfoClass, linkClass } from "@/lib/ui";
import { useAuthStore } from "@/stores/auth";

const route = useRoute();
const auth = useAuthStore();
const token = computed(() => (typeof route.query.token === "string" ? route.query.token : ""));
const error = ref("");
const done = ref(false);
const submitting = ref(false);

async function verify(): Promise<void> {
  error.value = "";
  if (!token.value) {
    error.value = "验证链接不完整，请回到注册邮箱重新打开";
    return;
  }
  submitting.value = true;
  try {
    await api.verifyEmail(token.value);
    await auth.refresh();
    done.value = true;
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? cause.message : "验证失败，请重新发送验证邮件";
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <AuthShell title="验证邮箱" subtitle="我们会等你点击确认后才消费验证令牌，避免邮件扫描器提前使用。">
    <div v-if="done" class="space-y-4">
      <p :class="alertInfoClass">邮箱已验证，现在可以进行发帖等写操作。</p>
      <div class="flex gap-4 text-sm">
        <RouterLink to="/me" :class="linkClass">个人中心</RouterLink>
        <RouterLink to="/" :class="linkClass">返回首页</RouterLink>
      </div>
    </div>

    <div v-else class="space-y-4">
      <p class="text-sm leading-6 text-muted-foreground">
        点击下面的按钮完成验证。验证链接有有效期；过期后可在个人中心重新发送。
      </p>
      <p v-if="error" :class="alertErrorClass">{{ error }}</p>
      <Button class="w-full" :disabled="submitting || !token" @click="verify">
        {{ submitting ? "验证中…" : "确认验证邮箱" }}
      </Button>
    </div>
  </AuthShell>
</template>
