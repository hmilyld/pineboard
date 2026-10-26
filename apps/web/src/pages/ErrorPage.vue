<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { useAuthStore } from "@/stores/auth";

const props = withDefaults(defineProps<{ code?: number }>(), { code: 404 });
const auth = useAuthStore();
function reload(): void { window.location.reload(); }
const copy = computed(() => {
  if (props.code === 403) return { title: "你没有权限看这里", text: "当前登录状态不足，或者这个版块不对外可见。可以换一个账户登录再试。" };
  if (props.code === 410) return { title: "这个主题已被删除", text: "内容已由作者或版主删除。你仍然可以回首页看看其他主题。" };
  if (props.code === 500) return { title: "服务暂时出了点问题", text: "稍后刷新再试。如果一直出现，请联系管理员，并附上你刚才的操作。" };
  return { title: "这个页面不在了", text: "链接可能过期、主题被删除，或者地址写错了。回首页重新找找。" };
});
</script>

<template>
  <main class="v2-page">
    <div class="v2-container">
    <div class="mx-auto flex min-h-[396px] max-w-[520px] flex-col items-center justify-center py-10 text-center">
      <span class="h-[3px] w-[34px] bg-pine" />
      <p class="num mt-4 text-[56px] font-bold leading-none tracking-[-0.045em]">{{ code }}</p>
      <h1 class="mt-3 text-[18px] font-bold">{{ copy.title }}</h1>
      <p class="mt-2 max-w-[340px] text-[11.5px] leading-[1.85] text-muted-foreground">{{ copy.text }}</p>
      <div class="mt-6 flex gap-2">
        <RouterLink to="/" class="v2-btn solid">回首页</RouterLink>
        <RouterLink v-if="code === 403 && !auth.user" to="/login" class="v2-btn">登录</RouterLink>
        <button v-else-if="code === 500" type="button" class="v2-btn" @click="reload">刷新</button>
        <RouterLink v-else to="/search" class="v2-btn">去搜索</RouterLink>
      </div>
      <p class="mt-4 text-[10.5px] text-muted-foreground">遇到问题？<a href="mailto:admin@pineboard.com" class="underline underline-offset-2">联系管理员</a></p>
    </div>
    </div>
  </main>
</template>
