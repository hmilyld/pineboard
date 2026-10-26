<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import AdminSkeleton from "@/components/AdminSkeleton.vue";
import PaginationBar from "@/components/PaginationBar.vue";
import { api, ApiClientError } from "@/lib/api";
import { confirmDialog } from "@/lib/confirm";
import { alertErrorClass, alertInfoClass, inputClass } from "@/lib/ui";
import { formatDate } from "@/lib/time";
import { useAuthStore } from "@/stores/auth";

type UserRow = {
  id: string; name: string; email: string; username: string | null; role: "user" | "moderator" | "admin";
  status: "active" | "suspended" | "deleting" | "deleted"; emailVerified: boolean;
  createdAt: number; topicCount: number; replyCount: number;
};

const auth = useAuthStore();
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
const statusTabs = [
  ["all", "全部"], ["active", "正常"], ["suspended", "封禁"], ["deleting", "注销中"],
] as const;
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
    error.value = cause instanceof ApiClientError ? cause.message : "加载用户失败";
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
    title: "修改用户角色",
    message: `将「${user.name}」从 ${user.role} 改为 ${next}？`,
    confirmLabel: "修改",
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
    message.value = "角色已更新。";
    await load(page.value);
  } catch (cause) {
    if (select) select.value = user.role;
    error.value = cause instanceof ApiClientError ? cause.message : "修改失败";
  } finally {
    busy.value = "";
  }
}

async function toggleSuspend(user: UserRow): Promise<void> {
  if (busy.value) return;
  const suspend = user.status !== "suspended";
  const ok = await confirmDialog({
    title: suspend ? "封禁用户" : "解除封禁",
    message: suspend ? `封禁「${user.name}」？其现有登录会话会立即失效。` : `解除「${user.name}」的封禁？`,
    confirmLabel: suspend ? "封禁" : "解封",
    danger: suspend,
  });
  if (!ok) return;
  busy.value = user.id;
  error.value = "";
  try {
    if (suspend) await api.suspendAdminUser(user.id);
    else await api.unsuspendAdminUser(user.id);
    message.value = suspend ? "用户已封禁。" : "用户已解封。";
    await load(page.value);
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? cause.message : "操作失败";
  } finally {
    busy.value = "";
  }
}

onMounted(() => load());
</script>

<template>
  <div>
    <div class="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
      <div><h1 class="text-[19px] font-bold leading-[1.3]">用户管理</h1><p class="mt-1 text-[10.5px] text-muted-foreground">搜索、角色调整与封禁；最后一名管理员受保护。</p></div>
      <form class="flex gap-2" @submit.prevent="search">
        <input v-model="q" :class="inputClass" class="h-8 w-[240px]" type="search" placeholder="邮箱 / 昵称 / @用户名" aria-label="搜索用户" />
        <button type="submit" class="v2-btn sm">搜索</button>
      </form>
    </div>

    <div class="mt-3 flex flex-wrap items-center gap-3">
      <div class="flex items-center gap-3 text-[11.5px]">
        <button v-for="[value, label] in statusTabs" :key="value" type="button" class="v2-tab" :data-active="status === value" @click="setStatus(value)">{{ label }}</button>
      </div>
      <select v-model="role" class="v2-input h-8 w-28 px-2 text-[11.5px]" aria-label="角色筛选" @change="load(1)">
        <option value="all">全部角色</option>
        <option value="user">普通用户</option>
        <option value="moderator">版主</option>
        <option value="admin">管理员</option>
      </select>
      <span class="ml-auto text-[10.5px] text-muted-foreground">共 {{ total }} 位用户</span>
    </div>

    <p v-if="message" :class="[alertInfoClass, 'mt-3']">{{ message }}</p>
    <p v-if="error" :class="[alertErrorClass, 'mt-3']">{{ error }}</p>
    <AdminSkeleton v-if="loading" class="mt-4" />
    <div v-else class="v2-admin-panel mt-4 overflow-x-auto">
      <table class="v2-admin-table min-w-[760px]">
        <thead><tr><th>用户</th><th>角色</th><th>状态</th><th>主题 / 回复</th><th>注册时间</th><th></th></tr></thead>
        <tbody>
          <tr v-for="user in users" :key="user.id">
            <td class="p-3">
              <b class="block text-[12px]">{{ user.name }}</b>
              <span class="block text-[10.5px] text-muted-foreground">{{ user.email }}<template v-if="user.username"> · @{{ user.username }}</template></span>
            </td>
            <td class="p-3">
              <select class="v2-input h-7 w-24 px-1.5 text-[11px]" :value="user.role" :disabled="busy === user.id || user.id === selfId" @change="changeRole(user, ($event.target as HTMLSelectElement).value, $event.target as HTMLSelectElement)">
                <option v-for="value in roles" :key="value" :value="value">{{ value }}</option>
              </select>
            </td>
            <td class="p-3"><span class="v2-status-pill" :class="{ active: user.status === 'active' }">{{ user.status }}</span></td>
            <td class="p-3 text-[11px] text-muted-foreground">{{ user.topicCount }} / {{ user.replyCount }}</td>
            <td class="p-3 text-[10.5px] text-muted-foreground">{{ formatDate(user.createdAt) }}</td>
            <td class="p-3 text-right">
              <button type="button" class="v2-btn sm" :class="{ danger: user.status === 'active' }" :disabled="busy === user.id || user.id === selfId || user.status === 'deleted' || user.status === 'deleting'" @click="toggleSuspend(user)">
                {{ user.status === "suspended" ? "解封" : "封禁" }}
              </button>
            </td>
          </tr>
          <tr v-if="!users.length"><td colspan="6" class="p-6 text-center text-muted-foreground">没有匹配的用户。</td></tr>
        </tbody>
      </table>
      <PaginationBar v-if="totalPages > 1" :page="page" :total-pages="totalPages" :total="total" unit="位用户" @change="load" />
    </div>
  </div>
</template>
