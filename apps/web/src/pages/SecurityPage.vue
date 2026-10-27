<script setup lang="ts">
import { derivePassword } from "@pineboard/shared";
import { confirmDialog } from "@/lib/confirm";
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import AccountShell from "@/components/AccountShell.vue";
import AccountSkeleton from "@/components/AccountSkeleton.vue";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { api } from "@/lib/api";
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
    error.value = config.describeError(cause, "security.summaryFailed");
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
    message.value = t("security.exportStarted");
  } catch (cause) {
    error.value = config.describeError(cause, "security.exportFailed");
  } finally {
    exporting.value = false;
  }
}

async function changePassword(): Promise<void> {
  error.value = "";
  message.value = "";
  if (!auth.user) return;
  if (!currentPassword.value) {
    error.value = t("security.currentPasswordRequired");
    return;
  }
  if (newPassword.value.length < minPasswordLength.value) {
    error.value = t("security.newPasswordTooShort", { n: minPasswordLength.value });
    return;
  }
  if (newPassword.value !== confirmPassword.value) {
    error.value = t("security.passwordMismatch");
    return;
  }
  if (newPassword.value === currentPassword.value) {
    error.value = t("security.passwordSame");
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
    message.value = t("security.passwordUpdated");
  } catch (cause) {
    error.value = config.describeError(cause, "security.changePasswordFailed");
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
    message.value = t("security.cancelDone");
  } catch (cause) {
    error.value = config.describeError(cause, "security.cancelFailed");
  } finally {
    cancelling.value = false;
  }
}

async function deleteAccount(): Promise<void> {
  error.value = "";
  if (!auth.user) return;
  if (!password.value) {
    error.value = t("security.passwordRequired");
    return;
  }
  if (!(await confirmDialog({
    title: t("security.deleteConfirmTitle"),
    message: t("security.deleteConfirmBody"),
    confirmLabel: t("security.deleteConfirmAction"),
    danger: true,
  }))) return;
  deleting.value = true;
  try {
    const derived = await derivePassword(auth.user.email, password.value);
    await api.deleteAccount(derived);
    message.value = t("security.deleteStarted");
    auth.user = null;
    auth.permissions = null;
    await router.push("/");
  } catch (cause) {
    error.value = config.describeError(cause, "security.deleteFailed");
  } finally {
    deleting.value = false;
  }
}
</script>

<template>
  <AccountSkeleton v-if="!auth.user || loading" />
  <AccountShell v-else-if="auth.user" :profile="profile" active="security" :topic-count="summary.topicCount" :reply-count="summary.replyCount" :like-count="summary.likeCount" :bookmark-count="summary.bookmarkCount" :notification-count="summary.unreadCount" is-self>
    <div class="v2-section-head"><h2>{{ t("security.title") }}</h2><span>{{ t("security.subtitle") }}</span></div>
    <p class="mb-3 text-[11.5px] leading-6 text-muted-foreground">{{ t("security.intro") }}</p>
    <section v-if="isDeleting" class="v2-note mb-3 flex flex-wrap items-center gap-3">
      <span class="min-w-0 flex-1">{{ t("security.deletionPending") }}</span>
      <button type="button" class="v2-btn solid sm" :disabled="cancelling" @click="cancelDeletion">{{ cancelling ? t("security.cancelling") : t("security.cancelDeletion") }}</button>
    </section>
    <p v-if="message" :class="[alertInfoClass, 'mb-3']">{{ message }}</p>
    <p v-if="error" :class="[alertErrorClass, 'mb-3']">{{ error }}</p>

    <section v-if="!isDeleting" class="v2-panel p-4">
      <h2 class="text-[12px] font-semibold">{{ t("security.changePassword") }}</h2>
      <p class="mt-1 text-[11px] leading-6 text-muted-foreground">{{ t("security.changePasswordHint") }}</p>
      <div class="mt-3 grid gap-3 sm:grid-cols-3">
        <div>
          <label class="v2-label" for="current-password">{{ t("security.currentPassword") }}</label>
          <input id="current-password" v-model="currentPassword" name="current-password" type="password" class="v2-input" autocomplete="current-password" :placeholder="t('security.currentPassword')" />
        </div>
        <div>
          <label class="v2-label" for="new-password">{{ t("security.newPassword") }}</label>
          <input id="new-password" v-model="newPassword" name="new-password" type="password" class="v2-input" autocomplete="new-password" :placeholder="t('auth.passwordMinPlaceholder', { n: minPasswordLength })" />
        </div>
        <div>
          <label class="v2-label" for="confirm-new-password">{{ t("security.confirmNewPassword") }}</label>
          <input id="confirm-new-password" v-model="confirmPassword" name="confirm-new-password" type="password" class="v2-input" autocomplete="new-password" :placeholder="t('security.confirmNewPassword')" />
        </div>
      </div>
      <div class="mt-3"><Button :disabled="changingPassword" @click="changePassword">{{ changingPassword ? t("auth.updating") : t("security.updatePassword") }}</Button></div>
    </section>

    <section class="v2-panel mt-3 p-4">
      <h2 class="text-[12px] font-semibold">{{ t("security.exportTitle") }}</h2>
      <p class="mt-1 text-[11px] leading-6 text-muted-foreground">{{ t("security.exportHint") }}</p>
      <Button class="mt-3" variant="outline" :disabled="exporting" @click="exportData">{{ exporting ? t("security.exporting") : t("security.exportButton") }}</Button>
    </section>

    <section v-if="!isDeleting" class="v2-panel mt-3 border-orange/40 p-4">
      <h2 class="text-[12px] font-semibold text-orange">{{ t("security.deleteTitle") }}</h2>
      <p class="mt-1 text-[11px] leading-6 text-muted-foreground">{{ t("security.deleteHint") }}</p>
      <div class="mt-3 max-w-xs">
        <label class="v2-label" for="delete-password">{{ t("security.deleteConfirmLabel") }}</label>
        <input id="delete-password" v-model="password" name="password" type="password" class="v2-input" autocomplete="current-password" :placeholder="t('security.deletePasswordPlaceholder')" />
      </div>
      <div class="mt-3 flex items-center gap-3"><Button variant="destructive" :disabled="deleting" @click="deleteAccount">{{ deleting ? t("common.working") : t("security.deleteButton") }}</Button><RouterLink to="/me" class="text-[11.5px] text-muted-foreground hover:text-ink">{{ t("security.backToCenter") }}</RouterLink></div>
    </section>
  </AccountShell>
</template>
