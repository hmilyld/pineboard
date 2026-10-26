<script setup lang="ts">
import type { Post } from "@pineboard/shared";
import { RouterLink } from "vue-router";
import MarkdownRenderer from "@/components/MarkdownRenderer.vue";
import RelativeTime from "@/components/RelativeTime.vue";
import ReportButton from "@/components/ReportButton.vue";
import { useAuthStore } from "@/stores/auth";

withDefaults(
  defineProps<{
    post: Post;
    canReply: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canViewHistory?: boolean;
    nested?: boolean;
    highlight?: boolean;
  }>(),
  { canViewHistory: false, nested: false, highlight: false },
);
const emit = defineEmits<{
  like: [Post];
  reply: [Post];
  quote: [Post];
  delete: [Post];
  edit: [Post];
  history: [Post];
}>();
const auth = useAuthStore();
</script>

<template>
  <article :id="`post-${post.floor}`" class="v2-post" :class="{ child: nested, 'is-highlight': highlight }">
    <aside class="v2-rail">
      <span class="v2-avatar" aria-hidden="true">{{ post.author.name.slice(0, 1) }}</span>
      <RouterLink v-if="post.author.username" :to="`/u/${post.author.username}`" class="v2-who">{{ post.author.name }}</RouterLink>
      <span v-else class="v2-who">{{ post.author.name }}</span>
      <span v-if="post.isFirst" class="v2-role">楼主</span>
      <span class="v2-time"><RelativeTime :seconds="post.createdAt" /><span v-if="post.editedAt"> · 已编辑</span></span>
      <span class="v2-floor">#{{ post.floor }}</span>
    </aside>
    <div class="v2-post-body">
      <div v-if="post.status === 'deleted'" class="text-[12px] text-muted-foreground">该楼层已删除</div>
      <template v-else>
        <MarkdownRenderer :source="post.contentMd" />
        <div class="v2-acts">
          <button type="button" @click="emit('quote', post)">引用</button>
          <button v-if="canReply" type="button" @click="emit('reply', post)">回复</button>
          <button v-if="auth.user" type="button" :class="{ 'font-medium text-[var(--pine)]': post.likedByMe }" @click="emit('like', post)">
            {{ post.likedByMe ? "已赞" : "赞" }} <span class="num">{{ post.likeCount }}</span>
          </button>
          <span v-else>赞 <span class="num">{{ post.likeCount }}</span></span>
          <span class="ml-auto" />
          <button v-if="canEdit" type="button" @click="emit('edit', post)">编辑</button>
          <button v-if="canViewHistory" type="button" @click="emit('history', post)">历史</button>
          <button v-if="canDelete" type="button" class="!text-[var(--orange)]" @click="emit('delete', post)">删除</button>
          <ReportButton :target-type="post.isFirst ? 'topic' : 'post'" :target-id="post.isFirst ? post.topicId : post.id" />
        </div>
      </template>
    </div>
  </article>
</template>
