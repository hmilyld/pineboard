<script setup lang="ts">
import type { AdminOverview } from "@pineboard/shared";
import { Menu, X } from "lucide-vue-next";
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, RouterView, useRoute, useRouter } from "vue-router";
import BrandMark from "@/components/BrandMark.vue";
import { t } from "@/i18n";
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
const pendingReviews = ref(0);

async function loadOverview(): Promise<void> {
  if (!isAdmin.value && !auth.user) return;
  try {
    overview.value = await api.adminOverview();
  } catch { /* header badge is optional */ }
  try {
    pendingReviews.value = (await api.pendingReviews()).items.length;
  } catch { /* the queue badge is optional too */ }
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
            <div><p class="text-[15px] font-bold leading-none">{{ config.siteName }}</p><p class="mt-1 text-[10px] text-white/50">{{ t("admin.shell.title") }}</p></div>
          </div>
          <button
            type="button"
            class="v2-admin-menu-btn"
            :aria-expanded="navOpen"
            aria-controls="admin-nav-menu"
            :aria-label="navOpen ? t('admin.shell.collapseNav') : t('admin.shell.expandNav')"
            @click="navOpen = !navOpen"
          >
            <X v-if="navOpen" :size="19" />
            <Menu v-else :size="19" />
          </button>
        </div>
        <div id="admin-nav-menu" class="v2-admin-menu">
          <nav class="v2-admin-nav" :aria-label="t('admin.shell.navLabel')">
            <p class="px-2 pb-1 text-[10px] text-white/40">{{ t("admin.shell.groupSite") }}</p>
            <RouterLink v-if="isAdmin" to="/admin" class="v2-admin-link" :class="{ on: route.name === 'admin-overview' }">{{ t("admin.nav.overview") }}</RouterLink>
            <RouterLink to="/admin/reports" class="v2-admin-link" :class="{ on: route.name === 'mod-reports' }">{{ t("admin.nav.reports") }} <span v-if="pending">{{ pending }}</span></RouterLink>
            <RouterLink to="/admin/reviews" class="v2-admin-link" :class="{ on: route.name === 'mod-reviews' }">{{ t("admin.nav.reviews") }} <span v-if="pendingReviews">{{ pendingReviews }}</span></RouterLink>
            <RouterLink v-if="isAdmin" to="/admin/categories" class="v2-admin-link" :class="{ on: route.name === 'admin-categories' }">{{ t("admin.nav.categories") }}</RouterLink>
            <RouterLink v-if="isAdmin" to="/admin/tags" class="v2-admin-link" :class="{ on: route.name === 'admin-tags' }">{{ t("admin.nav.tags") }}</RouterLink>
            <RouterLink v-if="isAdmin" to="/admin/users" class="v2-admin-link" :class="{ on: route.name === 'admin-users' }">{{ t("admin.nav.users") }}</RouterLink>
            <RouterLink v-if="isAdmin" to="/admin/nav" class="v2-admin-link" :class="{ on: route.name === 'admin-nav' }">{{ t("admin.nav.nav") }}</RouterLink>
            <RouterLink v-if="isAdmin" to="/admin/settings" class="v2-admin-link" :class="{ on: route.name === 'admin-settings' }">{{ t("admin.nav.settings") }}</RouterLink>
            <RouterLink v-if="isAdmin" to="/admin/integrations" class="v2-admin-link" :class="{ on: route.name === 'admin-integrations' }">{{ t("admin.nav.integrations") }}</RouterLink>
            <RouterLink v-if="isAdmin" to="/admin/emails" class="v2-admin-link" :class="{ on: route.name === 'admin-emails' }">{{ t("admin.nav.emails") }}</RouterLink>
            <RouterLink v-if="isAdmin" to="/admin/maintenance" class="v2-admin-link" :class="{ on: route.name === 'admin-maintenance' }">{{ t("admin.nav.maintenance") }}</RouterLink>
            <RouterLink v-if="isAdmin" to="/admin/audit" class="v2-admin-link" :class="{ on: route.name === 'admin-audit' }">{{ t("admin.nav.audit") }}</RouterLink>
          </nav>
          <div class="mt-auto border-t border-white/10 pt-3 text-[11px] text-white/60">
            <RouterLink to="/" class="block px-2 py-2 hover:text-white">← {{ t("admin.shell.backToForum") }}</RouterLink>
            <div class="mt-2 flex items-center gap-2 px-2">
              <span class="grid size-7 place-items-center rounded-full bg-white/15 text-[11px]">{{ auth.displayName.slice(0, 1) }}</span>
              <span class="min-w-0 flex-1 truncate">{{ auth.displayName }}</span>
              <span class="text-[10px] text-white/40">{{ isAdmin ? t("admin.shell.roleAdmin") : t("admin.shell.roleModerator") }}</span>
            </div>
            <button type="button" class="mt-2 px-2 py-1 text-[10.5px] text-white/50 hover:text-white" @click="signOut">{{ t("nav.signOut") }}</button>
          </div>
        </div>
      </aside>
      <main class="v2-admin-main"><RouterView /></main>
    </div>
  </div>
</template>
