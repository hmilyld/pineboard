<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import AdminSkeleton from "@/components/AdminSkeleton.vue";
import PaginationBar from "@/components/PaginationBar.vue";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { confirmDialog } from "@/lib/confirm";
import { alertErrorClass, alertInfoClass, inputClass } from "@/lib/ui";
import { formatDate } from "@/lib/time";
import { useAuthStore } from "@/stores/auth";
import { useConfigStore } from "@/stores/config";

type UserRow = {
  id: string; name: string; email: string; username: string | null; role: "user" | "moderator" | "admin";
  status: "active" | "suspended" | "deleting" | "deleted"; emailVerified: boolean;
  createdAt: number; topicCount: number; replyCount: number;
};

const auth = useAuthStore();
const config = useConfigStore();
const users = ref<UserRow[]>([]);
const q = ref("");
const status = ref("all");
const role = ref("all");
const page = ref(1);
const total = ref(0);
const totalPages = ref(1);
const loading = ref(true);
const busy = ref("");
const error = ref("");
const message = ref("");
const statusTabs = computed(() => [
  ["all", t("admin.users.statusAll")], ["active", t("admin.users.statusActive")],
  ["suspended", t("admin.users.statusSuspended")], ["deleting", t("admin.users.statusDeleting")],
] as const);
const roleLabel = (value: string): string =>
  value === "admin" ? t("account.roleAdmin") : value === "moderator" ? t("account.roleModerator") : t("admin.users.roleUser");
const statusLabel = (value: string): string => {
  const match = statusTabs.value.find(([key]) => key === value);
  return match ? match[1] : value;
};
const roles = ["user", "moderator", "admin"] as const;

const selfId = computed(() => auth.user?.id ?? "");

async function load(nextPage = 1): Promise<void> {
  loading.value = true;
  error.value = "";
  page.value = nextPage;
  try {
    const data = await api.adminUsers({ q: q.value.trim(), status: status.value, role: role.value, page: page.value });
    users.value = data.items as unknown as UserRow[];
    total.value = data.total;
    totalPages.value = data.totalPages;
  } catch (cause) {
    error.value = config.describeError(cause, "admin.users.loadFailed");
  } finally {
    loading.value = false;
  }
}

function search(): void {
  void load(1);
}

function setStatus(next: string): void {
  status.value = next;
  void load(1);
}

async function changeRole(user: UserRow, next: string, select?: HTMLSelectElement): Promise<void> {
  if (next === user.role || busy.value) {
    if (select) select.value = user.role;
    return;
  }
  const ok = await confirmDialog({
    title: t("admin.users.changeRoleTitle"),
    message: t("admin.users.changeRoleBody", { name: user.name, from: roleLabel(user.role), to: roleLabel(next) }),
    confirmLabel: t("admin.users.changeRoleConfirm"),
    danger: next === "admin",
  });
  if (!ok) {
    if (select) select.value = user.role;
    return;
  }
  busy.value = user.id;
  error.value = "";
  try {
    await api.updateAdminUserRole(user.id, next as UserRow["role"]);
    message.value = t("admin.users.roleUpdated");
    await load(page.value);
  } catch (cause) {
    if (select) select.value = user.role;
    error.value = config.describeError(cause, "admin.users.changeRoleFailed");
  } finally {
    busy.value = "";
  }
}

async function toggleSuspend(user: UserRow): Promise<void> {
  if (busy.value) return;
  const suspend = user.status !== "suspended";
  const ok = await confirmDialog({
    title: suspend ? t("admin.users.suspendTitle") : t("admin.users.unsuspendTitle"),
    message: suspend ? t("admin.users.suspendBody", { name: user.name }) : t("admin.users.unsuspendBody", { name: user.name }),
    confirmLabel: suspend ? t("admin.users.suspend") : t("admin.users.unsuspend"),
    danger: suspend,
  });
  if (!ok) return;
  busy.value = user.id;
  error.value = "";
  try {
    if (suspend) await api.suspendAdminUser(user.id);
    else await api.unsuspendAdminUser(user.id);
    message.value = suspend ? t("admin.users.suspended") : t("admin.users.unsuspended");
    await load(page.value);
  } catch (cause) {
    error.value = config.describeError(cause, "topic.failed");
  } finally {
    busy.value = "";
  }
}

onMounted(() => load());
</script>

<template>
  <div>
    <div class="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
      <div><h1 class="text-[19px] font-bold leading-[1.3]">{{ t("admin.nav.users") }}</h1><p class="mt-1 text-[10.5px] text-muted-foreground">{{ t("admin.users.subtitle") }}</p></div>
      <form class="flex gap-2" @submit.prevent="search">
        <input v-model="q" :class="inputClass" class="h-8 w-[240px]" type="search" :placeholder="t('admin.users.searchPlaceholder')" :aria-label="t('admin.users.searchLabel')" />
        <button type="submit" class="v2-btn sm">{{ t("admin.common.search") }}</button>
      </form>
    </div>

    <div class="mt-3 flex flex-wrap items-center gap-3">
      <div class="flex items-center gap-3 text-[11.5px]">
        <button v-for="[value, label] in statusTabs" :key="value" type="button" class="v2-tab" :data-active="status === value" @click="setStatus(value)">{{ label }}</button>
      </div>
      <select v-model="role" class="v2-input h-8 w-28 px-2 text-[11.5px]" :aria-label="t('admin.users.roleFilter')" @change="load(1)">
        <option value="all">{{ t("admin.users.allRoles") }}</option>
        <option value="user">{{ t("admin.users.roleUser") }}</option>
        <option value="moderator">{{ roleLabel("moderator") }}</option>
        <option value="admin">{{ roleLabel("admin") }}</option>
      </select>
      <span class="ml-auto text-[10.5px] text-muted-foreground">{{ t("admin.users.totalUsers", { count: total }) }}</span>
    </div>

    <p v-if="message" :class="[alertInfoClass, 'mt-3']">{{ message }}</p>
    <p v-if="error" :class="[alertErrorClass, 'mt-3']">{{ error }}</p>
    <AdminSkeleton v-if="loading" class="mt-4" />
    <div v-else class="v2-admin-panel mt-4 overflow-x-auto">
      <table class="v2-admin-table min-w-[760px]">
        <thead><tr><th>{{ t("admin.users.colUser") }}</th><th>{{ t("admin.users.colRole") }}</th><th>{{ t("admin.users.colStatus") }}</th><th>{{ t("admin.users.colCounts") }}</th><th>{{ t("admin.users.colJoined") }}</th><th></th></tr></thead>
        <tbody>
          <tr v-for="user in users" :key="user.id">
            <td class="p-3">
              <b class="block text-[12px]">{{ user.name }}</b>
              <span class="block text-[10.5px] text-muted-foreground">{{ user.email }}<template v-if="user.username"> · @{{ user.username }}</template></span>
            </td>
            <td class="p-3">
              <select class="v2-input h-7 w-24 px-1.5 text-[11px]" :value="user.role" :disabled="busy === user.id || user.id === selfId" @change="changeRole(user, ($event.target as HTMLSelectElement).value, $event.target as HTMLSelectElement)">
                <option v-for="value in roles" :key="value" :value="value">{{ roleLabel(value) }}</option>
              </select>
            </td>
            <td class="p-3"><span class="v2-status-pill" :class="{ active: user.status === 'active' }">{{ statusLabel(user.status) }}</span></td>
            <td class="p-3 text-[11px] text-muted-foreground">{{ user.topicCount }} / {{ user.replyCount }}</td>
            <td class="p-3 text-[10.5px] text-muted-foreground">{{ formatDate(user.createdAt) }}</td>
            <td class="p-3 text-right">
              <button type="button" class="v2-btn sm" :class="{ danger: user.status === 'active' }" :disabled="busy === user.id || user.id === selfId || user.status === 'deleted' || user.status === 'deleting'" @click="toggleSuspend(user)">
                {{ user.status === "suspended" ? t("admin.users.unsuspend") : t("admin.users.suspend") }}
              </button>
            </td>
          </tr>
          <tr v-if="!users.length"><td colspan="6" class="p-6 text-center text-muted-foreground">{{ t("admin.users.empty") }}</td></tr>
        </tbody>
      </table>
      <PaginationBar v-if="totalPages > 1" :page="page" :total-pages="totalPages" :total="total" :unit="t('admin.users.unit')" @change="load" />
    </div>
  </div>
</template>
