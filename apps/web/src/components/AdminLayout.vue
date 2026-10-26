<script setup lang="ts">
import type { AdminOverview } from "@pineboard/shared";
import { Menu, X } from "lucide-vue-next";
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, RouterView, useRoute, useRouter } from "vue-router";
import BrandMark from "@/components/BrandMark.vue";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";
import { useConfigStore } from "@/stores/config";

const auth = useAuthStore();
const config = useConfigStore();
const route = useRoute();
const router = useRouter();
const overview = ref<AdminOverview | null>(null);
const navOpen = ref(false);
const isAdmin = computed(() => auth.isAdmin);
const pending = computed(() => overview.value?.pendingReports ?? 0);

async function loadOverview(): Promise<void> {
  if (!isAdmin.value) return;
  try {
    overview.value = await api.adminOverview();
  } catch { /* header badge is optional */ }
}

async function signOut(): Promise<void> {
  try {
    await auth.signOut();
  } finally {
    await router.push("/");
  }
}

watch(() => route.fullPath, () => {
  navOpen.value = false;
});

onMounted(loadOverview);
</script>

<template>
  <div class="v2-admin">
    <div class="v2-admin-shell">
      <aside class="v2-admin-side" :class="{ 'is-open': navOpen }">
        <div class="v2-admin-brand-row">
          <div class="flex items-center gap-2.5 px-2">
            <BrandMark :size="22" :show-name="false" />
            <div><p class="text-[15px] font-bold leading-none">{{ config.siteName }}</p><p class="mt-1 text-[10px] text-white/50">管理后台</p></div>
          </div>
          <button
            type="button"
            class="v2-admin-menu-btn"
            :aria-expanded="navOpen"
            aria-controls="admin-nav-menu"
            :aria-label="navOpen ? '收起后台导航' : '展开后台导航'"
            @click="navOpen = !navOpen"
          >
            <X v-if="navOpen" :size="19" />
            <Menu v-else :size="19" />
          </button>
        </div>
        <div id="admin-nav-menu" class="v2-admin-menu">
          <nav class="v2-admin-nav" aria-label="后台导航">
            <p class="px-2 pb-1 text-[10px] text-white/40">站点</p>
            <RouterLink v-if="isAdmin" to="/admin" class="v2-admin-link" :class="{ on: route.name === 'admin-overview' }">概览</RouterLink>
            <RouterLink to="/admin/reports" class="v2-admin-link" :class="{ on: route.name === 'mod-reports' }">举报处理 <span v-if="pending">{{ pending }}</span></RouterLink>
            <RouterLink v-if="isAdmin" to="/admin/categories" class="v2-admin-link" :class="{ on: route.name === 'admin-categories' }">版块维护</RouterLink>
            <RouterLink v-if="isAdmin" to="/admin/tags" class="v2-admin-link" :class="{ on: route.name === 'admin-tags' }">标签维护</RouterLink>
            <RouterLink v-if="isAdmin" to="/admin/users" class="v2-admin-link" :class="{ on: route.name === 'admin-users' }">用户管理</RouterLink>
            <RouterLink v-if="isAdmin" to="/admin/nav" class="v2-admin-link" :class="{ on: route.name === 'admin-nav' }">导航维护</RouterLink>
            <RouterLink v-if="isAdmin" to="/admin/settings" class="v2-admin-link" :class="{ on: route.name === 'admin-settings' }">站点设置</RouterLink>
            <RouterLink v-if="isAdmin" to="/admin/integrations" class="v2-admin-link" :class="{ on: route.name === 'admin-integrations' }">集成配置</RouterLink>
            <RouterLink v-if="isAdmin" to="/admin/emails" class="v2-admin-link" :class="{ on: route.name === 'admin-emails' }">邮件日志</RouterLink>
            <RouterLink v-if="isAdmin" to="/admin/maintenance" class="v2-admin-link" :class="{ on: route.name === 'admin-maintenance' }">维护工具</RouterLink>
            <RouterLink v-if="isAdmin" to="/admin/audit" class="v2-admin-link" :class="{ on: route.name === 'admin-audit' }">审计日志</RouterLink>
          </nav>
          <div class="mt-auto border-t border-white/10 pt-3 text-[11px] text-white/60">
            <RouterLink to="/" class="block px-2 py-2 hover:text-white">← 返回论坛</RouterLink>
            <div class="mt-2 flex items-center gap-2 px-2">
              <span class="grid size-7 place-items-center rounded-full bg-white/15 text-[11px]">{{ auth.displayName.slice(0, 1) }}</span>
              <span class="min-w-0 flex-1 truncate">{{ auth.displayName }}</span>
              <span class="text-[10px] text-white/40">{{ isAdmin ? "管理员" : "版主" }}</span>
            </div>
            <button type="button" class="mt-2 px-2 py-1 text-[10.5px] text-white/50 hover:text-white" @click="signOut">退出登录</button>
          </div>
        </div>
      </aside>
      <main class="v2-admin-main"><RouterView /></main>
    </div>
  </div>
</template>
