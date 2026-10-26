<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";

type Profile = {
  id: string;
  name: string;
  username: string | null;
  role: string;
  bio: string | null;
  createdAt: number;
};

const props = withDefaults(
  defineProps<{
    profile: Profile;
    active: string;
    topicCount?: number;
    replyCount?: number;
    likeCount?: number;
    bookmarkCount?: number;
    notificationCount?: number;
    isSelf?: boolean;
  }>(),
  {
    topicCount: 0,
    replyCount: 0,
    likeCount: 0,
    bookmarkCount: 0,
    notificationCount: 0,
    isSelf: false,
  },
);
const auth = useAuthStore();
const router = useRouter();
const resending = ref(false);
const resendError = ref("");
const resent = ref(false);
const roleLabel = computed(() => (props.profile.role === "admin" ? "管理员" : props.profile.role === "moderator" ? "版主" : "成员"));
const joined = computed(() =>
  new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", timeZone: auth.user?.timezone ?? "Asia/Shanghai" }).format(new Date(props.profile.createdAt * 1000)),
);
const profileBase = computed(() => `/u/${props.profile.username ?? ""}`);
const topicsLink = computed(() => (props.isSelf ? "/me/topics" : { path: profileBase.value, query: { tab: "topics" } }));
const repliesLink = computed(() => (props.isSelf ? "/me/replies" : { path: profileBase.value, query: { tab: "replies" } }));

async function resendVerification(): Promise<void> {
  if (resending.value) return;
  resending.value = true;
  resendError.value = "";
  try {
    await api.resendVerification();
    resent.value = true;
  } catch (cause) {
    resendError.value = cause instanceof Error ? cause.message : "发送失败";
  } finally {
    resending.value = false;
  }
}

async function signOut(): Promise<void> {
  try {
    await auth.signOut();
  } finally {
    await router.push("/");
  }
}
</script>

<template>
  <main class="v2-account">
    <aside class="v2-account-nav" aria-label="个人中心导航">
      <div class="v2-account-group">
        <h3>内容</h3>
        <RouterLink :to="topicsLink" class="v2-account-link" :class="{ on: active === 'topics' }">{{ isSelf ? "我的主题" : "主题" }} <span>{{ topicCount }}</span></RouterLink>
        <RouterLink :to="repliesLink" class="v2-account-link" :class="{ on: active === 'replies' }">{{ isSelf ? "我的回复" : "回复" }} <span>{{ replyCount }}</span></RouterLink>
        <RouterLink v-if="isSelf" to="/me/bookmarks" class="v2-account-link" :class="{ on: active === 'bookmarks' }">我的收藏 <span>{{ bookmarkCount }}</span></RouterLink>
      </div>
      <div v-if="isSelf" class="v2-account-group">
        <h3>设置</h3>
        <RouterLink to="/notifications" class="v2-account-link" :class="{ on: active === 'notifications' }">通知 <span>{{ notificationCount }}</span></RouterLink>
        <RouterLink to="/me/preferences" class="v2-account-link" :class="{ on: active === 'preferences' }">邮件偏好</RouterLink>
        <RouterLink to="/me/security" class="v2-account-link" :class="{ on: active === 'security' }">账户与数据</RouterLink>
        <button type="button" class="v2-account-link w-full" @click="signOut">退出登录</button>
      </div>
    </aside>

    <div class="min-w-0">
      <div v-if="isSelf && !auth.isVerified" class="mb-2 flex items-center gap-3 border-l-[3px] border-l-[var(--amber)] bg-[var(--amber-soft)] px-3 py-2 text-[11px] text-[var(--muted)]">
        <span class="min-w-0 flex-1">邮箱还未验证，发帖和回复会被拦截。{{ resent ? "验证邮件已重新发送。" : "" }}</span>
        <button type="button" class="shrink-0 text-[var(--orange)] hover:underline" :disabled="resending" @click="resendVerification">{{ resending ? "发送中…" : "重新发送" }}</button>
      </div>
      <p v-if="resendError" class="mb-2 text-[11px] text-[var(--orange)]">{{ resendError }}</p>
      <header class="v2-profile-head">
        <div class="v2-profile-top">
          <span class="v2-profile-avatar" aria-hidden="true">{{ profile.name.slice(0, 1) }}</span>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <h1 class="v2-profile-name">{{ profile.name }}</h1>
              <span class="v2-role !mt-0">{{ roleLabel }}</span>
            </div>
            <p class="v2-profile-meta">@{{ profile.username }} · 加入于 {{ joined }}</p>
            <p v-if="profile.bio" class="v2-profile-bio">{{ profile.bio }}</p>
          </div>
          <div v-if="isSelf" class="hidden flex-none items-center gap-2 sm:flex">
            <RouterLink to="/me/security" class="v2-btn sm">账户设置</RouterLink>
          </div>
        </div>
        <div class="v2-profile-stats">
          <div class="v2-profile-stat"><b>{{ topicCount }}</b><span>主题</span></div>
          <div class="v2-profile-stat"><b>{{ replyCount }}</b><span>回复</span></div>
          <div class="v2-profile-stat"><b>{{ likeCount }}</b><span>获赞</span></div>
          <div class="v2-profile-stat"><b>{{ bookmarkCount }}</b><span>收藏</span></div>
        </div>
      </header>
      <slot />
    </div>
  </main>
</template>
