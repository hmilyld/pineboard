<script setup lang="ts">
import { derivePassword } from "@pineboard/shared";
import { confirmDialog } from "@/lib/confirm";
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import AccountShell from "@/components/AccountShell.vue";
import AccountSkeleton from "@/components/AccountSkeleton.vue";
import { Button } from "@/components/ui/button";
import { api, ApiClientError } from "@/lib/api";
import { alertErrorClass, alertInfoClass, cardClass, inputClass, labelClass, linkClass } from "@/lib/ui";
import { useAuthStore } from "@/stores/auth";
import { useConfigStore } from "@/stores/config";

const auth = useAuthStore();
const config = useConfigStore();
const router = useRouter();
const password = ref("");
const currentPassword = ref("");
const newPassword = ref("");
const confirmPassword = ref("");
const changingPassword = ref(false);
const error = ref("");
const message = ref("");
const exporting = ref(false);
const deleting = ref(false);
const cancelling = ref(false);
const loading = ref(true);
const summary = ref({ topicCount: 0, replyCount: 0, likeCount: 0, bookmarkCount: 0, unreadCount: 0 });
const profile = computed(() => ({ id: auth.user?.id ?? "", name: auth.user?.name ?? "", username: auth.user?.username ?? null, role: auth.user?.role ?? "user", bio: auth.user?.bio ?? null, createdAt: auth.user?.createdAt ?? 0 }));
const isDeleting = computed(() => auth.user?.status === "deleting");
const minPasswordLength = computed(() => config.config?.account.passwordMinLength ?? 8);

onMounted(async () => {
  try {
    summary.value = await api.meSummary();
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? cause.message : "加载账户摘要失败";
  } finally {
    loading.value = false;
  }
});

async function exportData(): Promise<void> {
  exporting.value = true;
  error.value = "";
  try {
    const blob = await api.exportAccount();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "forum-export.json";
    anchor.click();
    URL.revokeObjectURL(url);
    message.value = "导出文件已开始下载。";
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? cause.message : "导出失败";
  } finally {
    exporting.value = false;
  }
}

async function changePassword(): Promise<void> {
  error.value = "";
  message.value = "";
  if (!auth.user) return;
  if (!currentPassword.value) {
    error.value = "请输入当前密码";
    return;
  }
  if (newPassword.value.length < minPasswordLength.value) {
    error.value = `新密码至少 ${minPasswordLength.value} 位`;
    return;
  }
  if (newPassword.value !== confirmPassword.value) {
    error.value = "两次输入的新密码不一致";
    return;
  }
  if (newPassword.value === currentPassword.value) {
    error.value = "新密码不能与当前密码相同";
    return;
  }
  changingPassword.value = true;
  try {
    const [currentDerived, nextDerived] = await Promise.all([
      derivePassword(auth.user.email, currentPassword.value),
      derivePassword(auth.user.email, newPassword.value),
    ]);
    await api.changePassword(currentDerived, nextDerived);
    currentPassword.value = "";
    newPassword.value = "";
    confirmPassword.value = "";
    message.value = "密码已更新，其他设备的登录会话已退出。";
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? cause.message : "修改密码失败";
  } finally {
    changingPassword.value = false;
  }
}

async function cancelDeletion(): Promise<void> {
  cancelling.value = true;
  error.value = "";
  message.value = "";
  try {
    await api.cancelAccountDeletion();
    await auth.refresh();
    message.value = "已撤销注销申请，账户恢复正常。";
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? cause.message : "撤销失败";
  } finally {
    cancelling.value = false;
  }
}

async function deleteAccount(): Promise<void> {
  error.value = "";
  if (!auth.user) return;
  if (!password.value) {
    error.value = "请输入密码";
    return;
  }
  if (!(await confirmDialog({ title: "注销账户", message: "确认注销账户？账户会进入 7 天冷静期，期间可撤销；到期后昵称与邮箱会被匿名化，内容保留。", confirmLabel: "申请注销", danger: true }))) return;
  deleting.value = true;
  try {
    const derived = await derivePassword(auth.user.email, password.value);
    await api.deleteAccount(derived);
    message.value = "账户已进入注销冷静期，所有会话已失效。";
    auth.user = null;
    auth.permissions = null;
    await router.push("/");
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? cause.message : "注销失败";
  } finally {
    deleting.value = false;
  }
}
</script>

<template>
  <AccountSkeleton v-if="!auth.user || loading" />
  <AccountShell v-else-if="auth.user" :profile="profile" active="security" :topic-count="summary.topicCount" :reply-count="summary.replyCount" :like-count="summary.likeCount" :bookmark-count="summary.bookmarkCount" :notification-count="summary.unreadCount" is-self>
    <div class="v2-section-head"><h2>账户与数据</h2><span>导出或申请注销</span></div>
    <p class="mb-3 text-[11.5px] leading-6 text-muted-foreground">注销有 7 天冷静期，可在本页手动撤销。到期后昵称、邮箱、头像与简介会被匿名化，已发布内容保留。</p>
    <section v-if="isDeleting" class="v2-note mb-3 flex flex-wrap items-center gap-3">
      <span class="min-w-0 flex-1">账户正在注销冷静期，仍然可以撤销。撤销后所有功能立即恢复。</span>
      <button type="button" class="v2-btn solid sm" :disabled="cancelling" @click="cancelDeletion">{{ cancelling ? "撤销中…" : "撤销注销" }}</button>
    </section>
    <p v-if="message" :class="[alertInfoClass, 'mb-3']">{{ message }}</p>
    <p v-if="error" :class="[alertErrorClass, 'mb-3']">{{ error }}</p>

    <section v-if="!isDeleting" class="v2-panel p-4">
      <h2 class="text-[12px] font-semibold">修改密码</h2>
      <p class="mt-1 text-[11px] leading-6 text-muted-foreground">修改后其他设备会被退出登录，当前设备保持登录。</p>
      <div class="mt-3 grid gap-3 sm:grid-cols-3">
        <div>
          <label class="v2-label" for="current-password">当前密码</label>
          <input id="current-password" v-model="currentPassword" name="current-password" type="password" class="v2-input" autocomplete="current-password" placeholder="当前密码" />
        </div>
        <div>
          <label class="v2-label" for="new-password">新密码</label>
          <input id="new-password" v-model="newPassword" name="new-password" type="password" class="v2-input" autocomplete="new-password" :placeholder="`至少 ${minPasswordLength} 位`" />
        </div>
        <div>
          <label class="v2-label" for="confirm-new-password">确认新密码</label>
          <input id="confirm-new-password" v-model="confirmPassword" name="confirm-new-password" type="password" class="v2-input" autocomplete="new-password" placeholder="再次输入新密码" />
        </div>
      </div>
      <div class="mt-3"><Button :disabled="changingPassword" @click="changePassword">{{ changingPassword ? "更新中…" : "更新密码" }}</Button></div>
    </section>

    <section class="v2-panel mt-3 p-4">
      <h2 class="text-[12px] font-semibold">导出我的数据</h2>
      <p class="mt-1 text-[11px] leading-6 text-muted-foreground">包含账户摘要、主题、回复和收藏，不包含密码或会话令牌。</p>
      <Button class="mt-3" variant="outline" :disabled="exporting" @click="exportData">{{ exporting ? "导出中…" : "下载 JSON" }}</Button>
    </section>

    <section v-if="!isDeleting" class="v2-panel mt-3 border-orange/40 p-4">
      <h2 class="text-[12px] font-semibold text-orange">注销账户</h2>
      <p class="mt-1 text-[11px] leading-6 text-muted-foreground">账户进入 7 天冷静期；期间可在本页撤销。到期后个人资料匿名化，内容保留。</p>
      <div class="mt-3 max-w-xs">
        <label class="v2-label" for="delete-password">输入密码确认</label>
        <input id="delete-password" v-model="password" name="password" type="password" class="v2-input" autocomplete="current-password" placeholder="输入当前密码" />
      </div>
      <div class="mt-3 flex items-center gap-3"><Button variant="destructive" :disabled="deleting" @click="deleteAccount">{{ deleting ? "处理中…" : "申请注销" }}</Button><RouterLink to="/me" class="text-[11.5px] text-muted-foreground hover:text-ink">返回个人中心</RouterLink></div>
    </section>
  </AccountShell>
</template>
