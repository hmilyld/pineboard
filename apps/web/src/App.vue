<script setup lang="ts">
import type { Category, NavItem } from "@pineboard/shared";
import { Bell, ChevronDown, Menu, Search, Settings, X } from "lucide-vue-next";
import { computed, onBeforeUnmount, onMounted, ref, watch, watchEffect } from "vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { RouterLink, RouterView, useRoute, useRouter } from "vue-router";
import { api } from "@/lib/api";
import { categoryClass, categoryStyle } from "@/lib/category";
import { useAuthStore } from "@/stores/auth";
import { useConfigStore } from "@/stores/config";
import { useNotificationStore } from "@/stores/notifications";
import { useUiStore } from "@/stores/ui";

const config = useConfigStore();
const auth = useAuthStore();
const notifications = useNotificationStore();
const ui = useUiStore();
const router = useRouter();
const route = useRoute();
const appVersion = __APP_VERSION__;

const FALLBACK_NAV: NavItem[] = [
  { id: "nav-home", label: "首页", href: "/", kind: "link", parentId: null, sortOrder: 10, isVisible: true, openInNewTab: false },
  { id: "nav-categories", label: "版块", href: "", kind: "categories", parentId: null, sortOrder: 20, isVisible: true, openInNewTab: false },
  { id: "nav-tags", label: "标签", href: "/tags", kind: "link", parentId: null, sortOrder: 30, isVisible: true, openInNewTab: false },
];

const categories = ref<Category[]>([]);
const navItems = ref<NavItem[]>(FALLBACK_NAV);
const searchQ = ref("");
const drawerOpen = ref(false);
const openNavId = ref<string | null>(null);
const announcementDismissed = ref(false);

const isBare = computed(() => Boolean(route.meta.bare || route.meta.admin));
const isHome = computed(() => route.name === "home");
const isSearch = computed(() => route.name === "search");
const isCategory = computed(() => route.name === "category");
const announcement = computed(() => config.config?.site.announcement);
const showAnnouncement = computed(() => {
  const item = announcement.value;
  return Boolean(item?.enabled && item.text && !announcementDismissed.value);
});

function announcementKey(): string | null {
  const item = announcement.value;
  return item?.id ? `announcement.dismissed.${item.id}` : null;
}

function dismissAnnouncement(): void {
  const key = announcementKey();
  if (key) localStorage.setItem(key, "1");
  announcementDismissed.value = true;
}

function syncAnnouncement(): void {
  const key = announcementKey();
  announcementDismissed.value = Boolean(key && localStorage.getItem(key) === "1");
}

async function loadCategories(): Promise<void> {
  try {
    categories.value = await api.categories();
  } catch {
    categories.value = [];
  }
}

async function loadNavigation(): Promise<void> {
  try {
    navItems.value = await api.nav();
  } catch {
    navItems.value = FALLBACK_NAV;
  }
}

function isInternal(href: string): boolean {
  return href.startsWith("/");
}

function navActive(item: NavItem): boolean {
  if (item.kind === "categories") return isCategory.value;
  if (item.href === "/") return isHome.value;
  if (item.href.startsWith("/tags")) return route.name === "tags" || route.name === "tag";
  if (item.href.startsWith("/search")) return isSearch.value;
  return route.path === item.href || (item.href.length > 1 && route.path.startsWith(`${item.href}/`));
}

function onDropdownFocusOut(event: FocusEvent, id: string): void {
  const current = event.currentTarget as HTMLElement | null;
  const next = event.relatedTarget as Node | null;
  if (!current || !next || !current.contains(next)) {
    if (openNavId.value === id) openNavId.value = null;
  }
}

function onDocumentPointerDown(event: PointerEvent): void {
  const target = event.target as HTMLElement | null;
  if (!target?.closest(".v2-nav-dropdown")) openNavId.value = null;
}

function submitSearch(): void {
  const q = searchQ.value.trim();
  if (!q) return;
  void router.push({ name: "search", query: { q } });
  drawerOpen.value = false;
}

function closeDrawer(): void {
  drawerOpen.value = false;
  openNavId.value = null;
}

let unreadTimer: number | undefined;
function refreshUnread(): void {
  if (auth.user && document.visibilityState === "visible") void notifications.loadUnread();
}

onMounted(() => {
  void config.load();
  if (!auth.loaded) void auth.refresh();
  void loadCategories();
  void loadNavigation();
  syncAnnouncement();
  document.addEventListener("pointerdown", onDocumentPointerDown);
  unreadTimer = window.setInterval(refreshUnread, 5 * 60_000);
  window.addEventListener("focus", refreshUnread);
});

onBeforeUnmount(() => {
  if (unreadTimer) window.clearInterval(unreadTimer);
  window.removeEventListener("focus", refreshUnread);
  document.removeEventListener("pointerdown", onDocumentPointerDown);
});

watch(() => config.config?.site.announcement?.id, syncAnnouncement);
watch(() => route.fullPath, closeDrawer);
watch(
  () => Boolean(route.meta.admin),
  (isAdminRoute, wasAdminRoute) => {
    if (wasAdminRoute && !isAdminRoute) {
      void loadCategories();
      void loadNavigation();
      void config.load(true);
    }
  },
);

const appliedTokens = new Set<string>();
watchEffect(() => {
  const theme = config.config?.theme;
  if (!theme) return;
  const root = document.documentElement;
  root.lang = config.config?.site.language ?? "zh-CN";
  for (const key of appliedTokens) root.style.removeProperty(key);
  appliedTokens.clear();
  for (const [key, value] of Object.entries(theme.tokens ?? {})) {
    if (!key.startsWith("--")) continue;
    root.style.setProperty(key, value);
    appliedTokens.add(key);
  }
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  root.classList.toggle("dark", theme.darkMode === "dark" || (theme.darkMode === "system" && prefersDark));
  root.dataset.layout = theme.layout;
});

watch(
  () => config.config?.feature.pwa,
  (enabled) => {
    if (enabled === false && "serviceWorker" in navigator) {
      void navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) void registration.unregister();
      });
      ui.dismiss();
    }
  },
);

watch(
  () => auth.user,
  (user) => {
    if (user) void notifications.loadUnread();
    else notifications.clear();
  },
  { immediate: true },
);

watchEffect(() => {
  if (route.name === "home") document.title = config.siteName;
});

async function signOut(): Promise<void> {
  try {
    await auth.signOut();
  } finally {
    await router.push("/");
  }
}
</script>

<template>
  <div class="min-h-dvh" :class="isBare ? '' : 'flex flex-col'">
    <a v-if="!isBare" href="#main-content" class="skip-link">跳到主要内容</a>
    <div v-if="config.config?.maintenance.enabled && !auth.isAdmin && !isBare" class="border-b border-signal/40 bg-signal/10 px-4 py-2 text-center text-xs text-signal">
      {{ config.config.maintenance.message }}
    </div>

    <template v-if="!isBare">
      <header class="v2-header">
        <div class="v2-header-inner" :class="{ 'no-search': isSearch }">
          <RouterLink to="/" class="v2-brand">
            <img src="/icon.svg" alt="" aria-hidden="true" class="v2-mark v2-mark-icon" width="24" height="24" draggable="false" />
            <span class="v2-brand-name">{{ config.siteName }}</span>
          </RouterLink>

          <nav class="v2-nav" aria-label="主导航">
            <template v-for="item in navItems" :key="item.id">
              <div
                v-if="item.kind === 'categories' || item.kind === 'dropdown'"
                class="v2-nav-dropdown"
                @mouseenter="openNavId = item.id"
                @mouseleave="openNavId = null"
                @focusin="openNavId = item.id"
                @focusout="onDropdownFocusOut($event, item.id)"
              >
                <button
                  type="button"
                  class="v2-nav-dd-trigger"
                  :class="{ on: navActive(item) }"
                  :aria-expanded="openNavId === item.id"
                  aria-haspopup="true"
                  @click.stop="openNavId = item.id"
                >
                  {{ item.label }}<ChevronDown :size="11" class="v2-nav-arrow" :class="{ open: openNavId === item.id }" />
                </button>
                <div v-show="openNavId === item.id" class="v2-dropdown">
                  <template v-if="item.kind === 'categories'">
                    <RouterLink v-for="category in categories" :key="category.id" :to="`/c/${category.slug}`" @click="openNavId = null">
                      <i :class="categoryClass(category.slug)" :style="categoryStyle(category.color)" />{{ category.name }}
                      <span class="ml-auto text-[10px] text-muted-foreground">{{ category.topicCount ?? 0 }}</span>
                    </RouterLink>
                    <p v-if="!categories.length" class="px-2 py-2 text-[11px] text-muted-foreground">暂无可见版块</p>
                  </template>
                  <template v-else>
                    <template v-for="child in item.children ?? []" :key="child.id">
                      <RouterLink v-if="isInternal(child.href)" :to="child.href" @click="openNavId = null">{{ child.label }}</RouterLink>
                      <a v-else :href="child.href" :target="child.openInNewTab ? '_blank' : undefined" rel="noopener noreferrer" @click="openNavId = null">{{ child.label }}</a>
                    </template>
                    <p v-if="!item.children?.length" class="px-2 py-2 text-[11px] text-muted-foreground">暂无子链接</p>
                  </template>
                </div>
              </div>
              <RouterLink v-else-if="isInternal(item.href)" :to="item.href" :class="{ on: navActive(item) }">{{ item.label }}</RouterLink>
              <a v-else :href="item.href" :target="item.openInNewTab ? '_blank' : undefined" :rel="item.openInNewTab ? 'noopener noreferrer' : undefined">{{ item.label }}</a>
            </template>
          </nav>

          <form v-if="!isSearch" class="v2-search" role="search" @submit.prevent="submitSearch">
            <Search :size="13" aria-hidden="true" />
            <input v-model="searchQ" name="q" type="search" autocomplete="off" placeholder="搜索主题、标签、用户" aria-label="搜索主题、标签、用户" />
          </form>

          <div class="v2-hauth">
            <RouterLink v-if="auth.isAdmin" to="/admin" class="v2-admin-entry" aria-label="管理后台"><Settings :size="14" /><span>管理</span></RouterLink>
            <template v-if="auth.user">
              <RouterLink to="/notifications" class="v2-bell" aria-label="通知">
                <Bell :size="16" />
                <i v-if="notifications.unread > 0">{{ notifications.unread > 9 ? "9+" : notifications.unread }}</i>
              </RouterLink>
              <RouterLink to="/me" class="v2-me" :aria-label="`个人中心：${auth.displayName}`">{{ auth.displayName.slice(0, 1) }}</RouterLink>
              <RouterLink to="/new" class="v2-post-link hidden sm:inline-flex">＋ 发帖</RouterLink>
            </template>
            <template v-else>
              <RouterLink to="/login" class="login">登录</RouterLink>
              <RouterLink to="/register" class="reg">注册</RouterLink>
            </template>
            <button type="button" class="v2-mobile-toggle" aria-label="打开菜单" @click="drawerOpen = true"><Menu :size="20" /></button>
          </div>
        </div>
      </header>

      <div v-if="isHome && showAnnouncement && announcement" class="v2-notice">
        <span class="v2-notice-bar" />
        <b>公告</b>
        <RouterLink v-if="announcement.href" :to="announcement.href" class="min-w-0 truncate hover:text-foreground">{{ announcement.text }}</RouterLink>
        <p v-else>{{ announcement.text }}</p>
        <button type="button" aria-label="关闭公告" @click="dismissAnnouncement">×</button>
      </div>

      <div id="main-content" tabindex="-1" class="flex-1"><RouterView /></div>

      <footer class="v2-footer">
        <div class="v2-container v2-footer-inner">
          <div class="v2-footer-brand"><span class="fb"><img src="/icon.svg" alt="" aria-hidden="true" width="16" height="16" draggable="false" />{{ config.siteName }}</span><span class="v2-footer-tagline">{{ config.tagline }}</span></div>
          <nav class="v2-footer-links" aria-label="页脚导航">
            <RouterLink to="/">首页</RouterLink>
            <RouterLink to="/tags">标签</RouterLink>
            <RouterLink to="/search">搜索</RouterLink>
          </nav>
          <span class="v2-footer-copy">© {{ new Date().getFullYear() }} {{ config.siteName }} · v{{ appVersion }}</span>
        </div>
      </footer>
    </template>

    <RouterView v-if="isBare" />
    <ConfirmDialog />

    <div v-if="ui.needRefresh || ui.offlineReady" class="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md items-center gap-3 rounded-lg border border-border bg-card p-3 text-sm shadow-[0_12px_32px_rgba(0,0,0,.18)]">
      <span class="flex-1">{{ ui.needRefresh ? "站点已更新，刷新后生效。" : "已可离线浏览。" }}</span>
      <button v-if="ui.needRefresh" type="button" class="bg-brand px-3 py-1.5 text-xs text-[var(--on-orange)]" @click="ui.applyUpdate()">刷新</button>
      <button type="button" class="text-xs text-muted-foreground hover:text-foreground" @click="ui.dismiss()">关闭</button>
    </div>

    <div v-if="drawerOpen" class="v2-drawer" @click.self="closeDrawer" @keydown.esc="closeDrawer">
      <aside class="v2-drawer-panel" aria-label="移动导航">
        <div class="flex items-center justify-between">
          <RouterLink to="/" class="flex items-center gap-2.5" @click="closeDrawer"><img src="/icon.svg" alt="" aria-hidden="true" class="v2-mark v2-mark-icon" width="24" height="24" draggable="false" /><span class="v2-brand-name">{{ config.siteName }}</span></RouterLink>
          <button type="button" aria-label="关闭菜单" @click="closeDrawer"><X :size="20" /></button>
        </div>
        <div class="mt-5">
          <template v-for="item in navItems" :key="`drawer-${item.id}`">
            <RouterLink v-if="item.kind === 'link' && isInternal(item.href)" :to="item.href" @click="closeDrawer">{{ item.label }}</RouterLink>
            <a v-else-if="item.kind === 'link'" :href="item.href" :target="item.openInNewTab ? '_blank' : undefined" rel="noopener noreferrer" @click="closeDrawer">{{ item.label }}</a>
            <template v-else-if="item.kind === 'categories'">
              <p class="v2-drawer-title">{{ item.label }}</p>
              <RouterLink v-for="category in categories" :key="category.id" :to="`/c/${category.slug}`" @click="closeDrawer">
                <i :class="categoryClass(category.slug)" :style="categoryStyle(category.color)" class="mr-2 inline-block size-1.5 rounded-full" />{{ category.name }}
              </RouterLink>
            </template>
            <template v-else>
              <p class="v2-drawer-title">{{ item.label }}</p>
              <template v-for="child in item.children ?? []" :key="child.id">
                <RouterLink v-if="isInternal(child.href)" :to="child.href" class="pl-4" @click="closeDrawer">{{ child.label }}</RouterLink>
                <a v-else :href="child.href" class="pl-4" :target="child.openInNewTab ? '_blank' : undefined" rel="noopener noreferrer" @click="closeDrawer">{{ child.label }}</a>
              </template>
            </template>
          </template>
          <RouterLink to="/search" @click="closeDrawer">搜索</RouterLink>
          <RouterLink v-if="auth.user" to="/new" @click="closeDrawer">＋ 发帖</RouterLink>
        </div>
        <p class="v2-drawer-title">账户</p>
        <div v-if="auth.user">
          <RouterLink to="/me" @click="closeDrawer">{{ auth.displayName }}</RouterLink>
          <RouterLink to="/notifications" @click="closeDrawer">通知</RouterLink>
          <RouterLink v-if="auth.permissions?.isModerator" to="/admin/reports" @click="closeDrawer">审阅</RouterLink>
          <RouterLink v-if="auth.isAdmin" to="/admin" @click="closeDrawer">管理后台</RouterLink>
          <button type="button" class="flex min-h-[42px] w-full items-center border-b border-white/10 text-[15px] text-white/80" @click="signOut">退出登录</button>
        </div>
        <div v-else>
          <RouterLink to="/login" @click="closeDrawer">登录</RouterLink>
          <RouterLink to="/register" @click="closeDrawer">注册</RouterLink>
        </div>
      </aside>
    </div>
  </div>
</template>
