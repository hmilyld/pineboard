<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import AccountShell from "@/components/AccountShell.vue";
import AccountSkeleton from "@/components/AccountSkeleton.vue";
import EmptyState from "@/components/EmptyState.vue";
import ErrorState from "@/components/ErrorState.vue";
import LoadingRows from "@/components/LoadingRows.vue";
import PaginationBar from "@/components/PaginationBar.vue";
import { api, ApiClientError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";
import { useConfigStore } from "@/stores/config";
import { useNotificationStore } from "@/stores/notifications";

type NotificationItem = Awaited<ReturnType<typeof api.notifications>>["items"][number];
type Group = {
  key: string;
  label: string;
  items: NotificationItem[];
  unread: boolean;
  actorLabel: string;
  count: number;
  latest: NotificationItem;
};

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const config = useConfigStore();
const store = useNotificationStore();
const items = ref<NotificationItem[]>([]);
const unreadOnly = ref(false);
const page = ref(Math.max(1, Number(route.query.page ?? 1) || 1));
const total = ref(0);
const totalPages = ref(1);
const loading = ref(true);
const error = ref("");
const totalUnread = ref(0);
const summary = ref({ topicCount: 0, replyCount: 0, likeCount: 0, bookmarkCount: 0, unreadCount: 0 });

const profile = computed(() => ({
  id: auth.user?.id ?? "",
  name: auth.user?.name ?? "",
  username: auth.user?.username ?? null,
  role: auth.user?.role ?? "user",
  bio: auth.user?.bio ?? null,
  createdAt: auth.user?.createdAt ?? 0,
}));

function dayLabel(seconds: number): string {
  const timeZone = config.config?.site.timezone ?? "Asia/Shanghai";
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const day = fmt.format(new Date(seconds * 1000));
  const today = fmt.format(new Date());
  const yesterday = fmt.format(new Date(Date.now() - 86_400_000));
  return day === today ? "今天" : day === yesterday ? "昨天" : "更早";
}

const groups = computed<Group[]>(() => {
  const map = new Map<string, Group>();
  for (const item of items.value) {
    const day = dayLabel(item.createdAt);
    const mergeable = item.type === "topic_reply" || item.type === "post_reply";
    const key = mergeable ? `${day}:${item.topicId}:reply` : `${day}:${item.id}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        key,
        label: day,
        items: [item],
        unread: !item.readAt,
        actorLabel: item.actor?.name ?? "系统",
        count: 1,
        latest: item,
      });
    } else {
      existing.items.push(item);
      existing.count++;
      existing.unread ||= !item.readAt;
      if (item.createdAt > existing.latest.createdAt) existing.latest = item;
      const names = [...new Set(existing.items.map((entry) => entry.actor?.name).filter(Boolean))] as string[];
      existing.actorLabel = names.length > 2 ? `${names.slice(0, 2).join("、")} 等 ${names.length} 人` : names.join("、");
    }
  }
  return [...map.values()].sort((a, b) => b.latest.createdAt - a.latest.createdAt);
});

const grouped = computed(() => {
  const order = ["今天", "昨天", "更早"];
  return order.map((label) => ({ label, groups: groups.value.filter((group) => group.label === label) })).filter((section) => section.groups.length);
});

function target(item: NotificationItem): string {
  const perPage = config.config?.seo.postsPerPage ?? 20;
  const floor = item.postFloor ?? 1;
  const pageNo = Math.max(1, Math.ceil(floor / perPage));
  return `/t/${item.topicId}${pageNo > 1 ? `?page=${pageNo}` : ""}#post-${floor}`;
}

async function load(nextPage = page.value): Promise<void> {
  loading.value = true;
  error.value = "";
  page.value = Number.isFinite(nextPage) && nextPage > 0 ? Math.floor(nextPage) : 1;
  try {
    const data = await api.notifications({ page: page.value, perPage: 30, unread: unreadOnly.value });
    items.value = data.items;
    page.value = data.page;
    total.value = data.total;
    totalPages.value = data.totalPages;
    totalUnread.value = data.unread;
    summary.value.unreadCount = data.unread;
    store.setUnread(data.unread);
    const query = page.value > 1 ? { page: String(page.value) } : {};
    if (route.query.page !== query.page) await router.replace({ query });
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? cause.message : "加载失败";
  } finally {
    loading.value = false;
  }
}

function goPage(next: number): void {
  if (next === page.value) return;
  void load(next);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function init(): Promise<void> {
  try {
    summary.value = await api.meSummary();
  } catch {
    /* notifications still render if the summary request fails */
  }
  await load(page.value);
}

async function markAll(): Promise<void> {
  error.value = "";
  try {
    await api.markNotificationsRead({ all: true });
    summary.value.unreadCount = 0;
    await load(1);
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? cause.message : "标记已读失败";
  }
}

async function openGroup(group: Group): Promise<void> {
  if (!group.unread) return;
  const unreadCount = group.items.filter((item) => !item.readAt).length;
  try {
    await api.markNotificationsRead({ ids: group.items.map((item) => item.id) });
    for (const item of group.items) if (!item.readAt) item.readAt = Math.floor(Date.now() / 1000);
    summary.value.unreadCount = Math.max(0, summary.value.unreadCount - unreadCount);
    store.setUnread(Math.max(0, store.unread - unreadCount));
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? cause.message : "标记已读失败";
  }
}

function toggleUnread(): void {
  unreadOnly.value = !unreadOnly.value;
  void load(1);
}

watch(
  () => route.query.page,
  () => {
    const next = Math.max(1, Number(route.query.page ?? 1) || 1);
    if (next !== page.value) void load(next);
  },
);

onMounted(() => {
  void config.load();
  if (!auth.loaded) void auth.refresh();
  void init();
});
</script>

<template>
  <AccountShell
    v-if="auth.user"
    :profile="profile"
    active="notifications"
    :topic-count="summary.topicCount"
    :reply-count="summary.replyCount"
    :like-count="summary.likeCount"
    :bookmark-count="summary.bookmarkCount"
    :notification-count="summary.unreadCount"
    is-self
  >
    <div class="v2-section-head">
      <h2>通知</h2>
      <span>有人回复、提到你，或处理了你的举报 · 未读 {{ totalUnread }}</span>
      <div class="ml-auto flex items-center gap-2">
        <button type="button" class="v2-btn sm" role="switch" :aria-checked="unreadOnly" @click="toggleUnread">只看未读</button>
        <button type="button" class="text-[11.5px] text-muted-foreground hover:text-ink" @click="markAll">全部标为已读</button>
      </div>
    </div>

    <ErrorState v-if="error" :message="error" retry @retry="load()" />
    <div v-else-if="loading" class="v2-panel"><LoadingRows :rows="5" /></div>
    <div v-else-if="!groups.length" class="v2-panel"><EmptyState title="暂时没有通知" message="去看看最新主题。"><RouterLink to="/" class="mt-3 inline-block text-[11.5px] text-pine">回到首页</RouterLink></EmptyState></div>
    <template v-else>
      <section v-for="section in grouped" :key="section.label" class="mt-3 first:mt-0">
        <div class="flex items-center gap-3 px-1 pb-1.5 text-[10.5px] text-muted-foreground"><span>{{ section.label }}</span><span class="h-px flex-1 bg-line" /></div>
        <div class="v2-panel">
          <RouterLink
            v-for="group in section.groups"
            :key="group.key"
            :to="target(group.latest)"
            class="grid grid-cols-[32px_minmax(0,1fr)] gap-2.5 border-b border-line px-3.5 py-3 last:border-b-0"
            :class="group.unread ? 'border-l-[3px] border-l-pine bg-[color-mix(in_srgb,var(--pine)_4.5%,var(--surface))]' : ''"
            @click="openGroup(group)"
          >
            <span class="grid size-8 place-items-center rounded-[3px] bg-pine text-[12px] font-semibold text-on-pine">{{ (group.latest.actor?.name ?? "工").slice(0, 1) }}</span>
            <div class="min-w-0">
              <p class="text-[11px] text-muted-foreground">
                {{ group.actorLabel }} <template v-if="group.latest.type === 'mention'">在回复里提到了你</template><template v-else-if="group.latest.type === 'moderation'">处理了你的举报</template><template v-else>回复了你的主题</template>
              </p>
              <div class="mt-0.5 flex items-center gap-2">
                <span class="truncate text-[14px] font-semibold" :class="group.unread ? 'text-ink' : ''">{{ group.latest.title }}</span>
                <span v-if="group.count > 1" class="v2-tag !py-0 !text-[9px]">{{ group.count }} 条</span>
              </div>
              <p class="mt-0.5 truncate text-[11px] text-muted-foreground">{{ group.latest.snippet }}</p>
            </div>
          </RouterLink>
        </div>
      </section>
      <div v-if="totalPages > 1" class="mt-4 border-t border-line">
        <PaginationBar :page="page" :total-pages="totalPages" :total="total" unit="条通知" @change="goPage" />
      </div>
    </template>
  </AccountShell>
  <AccountSkeleton v-else />
</template>
