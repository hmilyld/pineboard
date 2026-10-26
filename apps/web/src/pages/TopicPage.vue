<script setup lang="ts">
import type { Category, Post, TopicDetail } from "@pineboard/shared";
import { confirmDialog } from "@/lib/confirm";
import { History, MoreHorizontal, Pencil, Trash2 } from "lucide-vue-next";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import ErrorState from "@/components/ErrorState.vue";
import MarkdownEditor from "@/components/MarkdownEditor.vue";
import PageSkeleton from "@/components/PageSkeleton.vue";
import PaginationBar from "@/components/PaginationBar.vue";
import PostItem from "@/components/PostItem.vue";
import RelativeTime from "@/components/RelativeTime.vue";
import TagChips from "@/components/TagChips.vue";
import TurnstileWidget from "@/components/TurnstileWidget.vue";
import { api, ApiClientError } from "@/lib/api";
import { categoryClass, categoryStyle } from "@/lib/category";
import { ensureSkeletonDuration } from "@/lib/ui";
import { useAuthStore } from "@/stores/auth";
import { useConfigStore } from "@/stores/config";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const config = useConfigStore();

const detail = ref<TopicDetail | null>(null);
const replies = ref<Post[]>([]);
const categories = ref<Category[]>([]);
const page = ref(1);
const totalPages = ref(1);
const total = ref(0);
const loading = ref(true);
let loadSeq = 0;
const error = ref("");
const actionError = ref("");
const liking = ref<Record<string, boolean>>({});
const bookmarking = ref(false);
const highlightFloor = ref<number | null>(null);
const onlyOp = computed(() => route.query.onlyOp === "1");
const topicId = computed(() => String(route.params.id));
const turnstileEnabled = computed(() => Boolean(config.config?.feature.turnstile && config.turnstileSiteKey));

const replyContent = ref("");
const replyTo = ref<Post | null>(null);
const token = ref("");
const widget = ref<{ reset(): void; show(): void } | null>(null);
const submitting = ref(false);
const editingReply = ref<Post | null>(null);
const editContent = ref("");
const editReason = ref("");
const editError = ref("");
const savingEdit = ref(false);
const pinLevel = ref<0 | 1 | 2>(0);
const moveCategory = ref("");
const modBusy = ref(false);

const postIds = computed(() => new Set(replies.value.map((post) => post.id)));
const topLevel = computed(() => replies.value.filter((post) => !post.parentPostId || !postIds.value.has(post.parentPostId)));
const children = computed(() => {
  const map = new Map<string, Post[]>();
  for (const post of replies.value) {
    if (!post.parentPostId || !postIds.value.has(post.parentPostId)) continue;
    const list = map.get(post.parentPostId) ?? [];
    list.push(post);
    map.set(post.parentPostId, list);
  }
  return map;
});

function canEdit(post: Post): boolean {
  if (!auth.user || !detail.value) return false;
  if (post.isFirst) return detail.value.viewer.canEdit;
  return auth.isAdmin || detail.value.viewer.canModerate || auth.user.id === post.author.id;
}

function canDelete(post: Post): boolean {
  if (!auth.user || !detail.value) return false;
  if (post.isFirst) return detail.value.viewer.canDelete;
  return auth.isAdmin || detail.value.viewer.canModerate || auth.user.id === post.author.id;
}

function startEdit(post: Post): void {
  if (post.isFirst) {
    void router.push(`/t/${post.topicId}/edit`);
    return;
  }
  editingReply.value = post;
  editContent.value = post.contentMd;
  editReason.value = "";
  editError.value = "";
  void nextTick(() => document.getElementById("reply-edit")?.scrollIntoView({ behavior: "smooth", block: "center" }));
}

function cancelEdit(): void {
  editingReply.value = null;
  editContent.value = "";
  editError.value = "";
}

async function saveReplyEdit(): Promise<void> {
  if (!editingReply.value) return;
  if (!editContent.value.trim()) {
    editError.value = "正文不能为空";
    return;
  }
  savingEdit.value = true;
  editError.value = "";
  try {
    await api.editPost(editingReply.value.id, {
      version: editingReply.value.version,
      contentMd: editContent.value,
      reason: editReason.value.trim() || undefined,
    });
    cancelEdit();
    await load();
  } catch (cause) {
    editError.value = cause instanceof ApiClientError ? cause.message : "保存失败";
  } finally {
    savingEdit.value = false;
  }
}

async function loadPosts(): Promise<void> {
  const data = await api.posts(topicId.value, { page: page.value, perPage: config.config?.seo.postsPerPage ?? 20, onlyOp: onlyOp.value });
  replies.value = data.items;
  page.value = data.page;
  totalPages.value = data.totalPages;
  total.value = data.total;
  if (page.value > data.totalPages) {
    page.value = data.totalPages;
    await router.replace({ query: { ...route.query, page: String(page.value) } });
    return loadPosts();
  }
}

async function load(): Promise<void> {
  const seq = ++loadSeq;
  const started = performance.now();
  loading.value = true;
  error.value = "";
  replyTo.value = null;
  replyContent.value = "";
  try {
    const data = await api.topic(topicId.value);
    if (seq !== loadSeq) return;
    detail.value = data;
    pinLevel.value = data.topic.pinLevel as 0 | 1 | 2;
    page.value = Math.max(1, Number(route.query.page ?? 1) || 1);
    await loadPosts();
    if (seq !== loadSeq) return;
    if (data.viewer.canModerate) categories.value = await api.categories();
    const viewKey = `viewed:${topicId.value}`;
    if (!sessionStorage.getItem(viewKey)) {
      sessionStorage.setItem(viewKey, "1");
      void api.viewTopic(topicId.value).catch(() => undefined);
    }
    const hash = window.location.hash.match(/^#post-(\d+)$/);
    if (hash) {
      highlightFloor.value = Number(hash[1]);
      await nextTick();
      document.getElementById(`post-${hash[1]}`)?.scrollIntoView({ block: "center" });
      window.setTimeout(() => (highlightFloor.value = null), 2000);
    }
  } catch (cause) {
    if (seq === loadSeq) error.value = cause instanceof ApiClientError ? cause.message : "主题加载失败";
  } finally {
    await ensureSkeletonDuration(started);
    if (seq === loadSeq) loading.value = false;
  }
}

function goPage(next: number): void {
  if (next === page.value) return;
  const query: Record<string, string> = { ...(route.query as Record<string, string>) };
  if (next <= 1) delete query.page;
  else query.page = String(next);
  void router.replace({ query });
  void nextTick(() => document.getElementById("topic-top")?.scrollIntoView({ block: "start" }));
}

function toggleOnlyOp(): void {
  const query: Record<string, string> = { ...(route.query as Record<string, string>) };
  if (onlyOp.value) delete query.onlyOp;
  else query.onlyOp = "1";
  delete query.page;
  void router.replace({ query });
}

function quote(post: Post): void {
  // Quoting is a normal new floor; only "回复" nests under an existing floor.
  replyTo.value = null;
  const firstLine = post.contentText.split("\n")[0]?.slice(0, 80) ?? "";
  replyContent.value = `> #${post.floor} ${post.author.name}：${firstLine}\n\n${replyContent.value}`;
  void nextTick(() => document.getElementById("reply-editor")?.scrollIntoView({ behavior: "smooth", block: "center" }));
}

function replyToPost(post: Post): void {
  replyTo.value = post.isFirst ? null : post;
  void nextTick(() => document.getElementById("reply-editor")?.scrollIntoView({ behavior: "smooth", block: "center" }));
}

async function submitReply(): Promise<void> {
  actionError.value = "";
  if (!replyContent.value.trim()) {
    actionError.value = "请输入回复内容";
    return;
  }
  if (turnstileEnabled.value && !token.value) {
    widget.value?.show();
    actionError.value = "请先完成人机验证";
    return;
  }
  submitting.value = true;
  try {
    await api.createReply(topicId.value, { contentMd: replyContent.value, parentPostId: replyTo.value?.id }, token.value);
    replyContent.value = "";
    replyTo.value = null;
    widget.value?.reset();
    token.value = "";
    detail.value = await api.topic(topicId.value);
    const lastPage = Math.max(1, Math.ceil((total.value + 1) / (config.config?.seo.postsPerPage ?? 20)));
    if (lastPage !== page.value) {
      await router.replace({ query: { ...route.query, page: String(lastPage) } });
      await nextTick();
    }
    await load();
  } catch (cause) {
    if (cause instanceof ApiClientError) {
      actionError.value = cause.message;
      if (cause.code === "captcha_failed" || cause.code === "captcha_unavailable") {
        widget.value?.reset();
        token.value = "";
      }
    } else actionError.value = "回复失败";
  } finally {
    submitting.value = false;
  }
}

async function toggleLike(post: Post): Promise<void> {
  if (liking.value[post.id]) return;
  liking.value = { ...liking.value, [post.id]: true };
  try {
    const data = await api.likePost(post.id);
    post.likeCount = data.likeCount;
    post.likedByMe = data.liked;
    if (post.isFirst && detail.value) {
      detail.value.topic.likeCount = data.likeCount;
      detail.value.firstPost.likedByMe = data.liked;
    }
  } catch (cause) {
    actionError.value = cause instanceof ApiClientError ? cause.message : "点赞失败";
  } finally {
    const { [post.id]: _done, ...rest } = liking.value;
    liking.value = rest;
  }
}

async function toggleBookmark(): Promise<void> {
  if (!detail.value || bookmarking.value) return;
  bookmarking.value = true;
  try {
    const data = await api.bookmarkTopic(topicId.value);
    detail.value.viewer.bookmarked = data.bookmarked;
  } catch (cause) {
    actionError.value = cause instanceof ApiClientError ? cause.message : "收藏失败";
  } finally {
    bookmarking.value = false;
  }
}

async function removeTopic(): Promise<void> {
  if (!(await confirmDialog({ title: "删除主题", message: "删除整个主题？此操作会软删除所有回复。", confirmLabel: "删除", danger: true }))) return;
  try {
    await api.deleteTopic(topicId.value);
    await router.push("/");
  } catch (cause) {
    actionError.value = cause instanceof ApiClientError ? cause.message : "删除失败";
  }
}

async function removePost(post: Post): Promise<void> {
  if (post.isFirst) return removeTopic();
  if (!(await confirmDialog({ title: "删除回复", message: "删除这条回复？", confirmLabel: "删除", danger: true }))) return;
  try {
    await api.deletePost(post.id);
    await load();
  } catch (cause) {
    actionError.value = cause instanceof ApiClientError ? cause.message : "删除失败";
  }
}

async function setPin(level: 0 | 1 | 2): Promise<void> {
  modBusy.value = true;
  try {
    await api.pinTopic(topicId.value, level);
    detail.value = await api.topic(topicId.value);
    pinLevel.value = level;
  } catch (cause) {
    actionError.value = cause instanceof ApiClientError ? cause.message : "置顶失败";
  } finally {
    modBusy.value = false;
  }
}

async function toggleLock(): Promise<void> {
  if (!detail.value) return;
  modBusy.value = true;
  try {
    await api.lockTopic(topicId.value, !detail.value.topic.isLocked);
    detail.value = await api.topic(topicId.value);
  } catch (cause) {
    actionError.value = cause instanceof ApiClientError ? cause.message : "操作失败";
  } finally {
    modBusy.value = false;
  }
}

async function toggleDigest(): Promise<void> {
  if (!detail.value) return;
  modBusy.value = true;
  try {
    const data = await api.setDigest(topicId.value, !detail.value.topic.isDigest);
    detail.value.topic.isDigest = data.isDigest;
  } catch (cause) {
    actionError.value = cause instanceof ApiClientError ? cause.message : "精华操作失败";
  } finally {
    modBusy.value = false;
  }
}

async function move(): Promise<void> {
  if (!moveCategory.value) return;
  modBusy.value = true;
  try {
    await api.moveTopic(topicId.value, moveCategory.value);
    detail.value = await api.topic(topicId.value);
    moveCategory.value = "";
  } catch (cause) {
    actionError.value = cause instanceof ApiClientError ? cause.message : "移动失败";
  } finally {
    modBusy.value = false;
  }
}

function openHistory(post: Post): void {
  void router.push({ name: "topic-history", params: { id: topicId.value }, query: { postId: post.id } });
}

onMounted(() => {
  void config.load();
  void load();
});
watch(topicId, () => load());
watch([() => route.query.page, () => route.query.onlyOp], () => {
  void load();
});
</script>

<template>
  <main class="v2-page">
    <div class="v2-container">
      <PageSkeleton v-if="loading" variant="detail" :header="false" />
      <ErrorState v-else-if="error" :message="error" retry @retry="load" />
      <template v-else-if="detail && detail.firstPost">
        <div>
          <div class="min-w-0">
            <div id="topic-top" class="scroll-mt-32">
              <nav class="v2-crumb" :class="categoryClass(detail.topic.category.slug)" :style="categoryStyle(detail.topic.category.color)">
                <RouterLink to="/">首页</RouterLink><span class="sep">/</span><i /><RouterLink :to="`/c/${detail.topic.category.slug}`" class="v2-catlink">{{ detail.topic.category.name }}</RouterLink>
              </nav>

              <header class="v2-topic-head mt-2" :class="categoryClass(detail.topic.category.slug)" :style="categoryStyle(detail.topic.category.color)">
                <div class="min-w-0 flex-1">
                  <h1>{{ detail.topic.title }}</h1>
                  <div class="v2-tmeta">
                    <RouterLink v-if="detail.topic.author.username" :to="`/u/${detail.topic.author.username}`"><b>{{ detail.topic.author.name }}</b></RouterLink>
                    <span class="v2-dot" />
                    <span><RelativeTime :seconds="detail.topic.createdAt" /></span><span class="v2-dot" /><span>{{ detail.topic.replyCount }} 回复</span><span class="v2-dot" /><span>{{ detail.topic.viewCount }} 浏览</span>
                    <span v-if="detail.topic.isLocked" class="text-[var(--orange)]">已锁定</span>
                  </div>
                  <div v-if="detail.topic.tags.length" class="mt-2"><TagChips :tags="detail.topic.tags" /></div>
                </div>
                <div class="flex flex-none flex-wrap items-center gap-2">
                  <button type="button" class="v2-switch" role="switch" :aria-checked="onlyOp" @click="toggleOnlyOp">
                    <span class="v2-switch-track" aria-hidden="true" />只看楼主
                  </button>
                  <button v-if="auth.user" type="button" class="v2-btn sm" @click="toggleBookmark">{{ detail.viewer.bookmarked ? "已收藏" : "收藏" }}</button>
                  <details v-if="auth.user" class="v2-actions-menu">
                    <summary class="v2-btn sm" aria-label="主题操作"><MoreHorizontal :size="14" /></summary>
                    <div class="v2-dropdown">
                      <RouterLink v-if="detail.viewer.canEdit" :to="`/t/${detail.topic.id}/edit`"><Pencil :size="13" />编辑主题</RouterLink>
                      <button v-if="detail.viewer.canViewHistory" type="button" @click="openHistory(detail.firstPost)"><History :size="13" />修订历史</button>
                      <span class="v2-dropdown-sep" />
                      <button v-if="detail.viewer.canDelete" type="button" class="danger" @click="removeTopic"><Trash2 :size="13" />删除主题</button>
                    </div>
                  </details>
                </div>
              </header>
            </div>

            <div v-if="actionError" class="fixed inset-x-4 bottom-4 z-[70] mx-auto max-w-md border border-orange/40 bg-card px-3 py-2 text-[11.5px] text-ink shadow-lg" role="alert">
              <span class="mr-2">{{ actionError }}</span>
              <button type="button" class="text-muted-foreground hover:text-ink" @click="actionError = ''">关闭</button>
            </div>

            <details v-if="detail.viewer.canModerate" class="v2-panel mb-3 mt-3 p-3">
              <summary class="cursor-pointer text-[12px] font-medium">版主操作</summary>
              <div class="v2-inline-controls mt-3 items-end text-[12px]">
                <label class="flex flex-col gap-1"><span class="text-[10.5px] text-muted-foreground">置顶</span>
                  <select :value="pinLevel" class="v2-input w-28 px-2" :disabled="modBusy" @change="setPin(Number(($event.target as HTMLSelectElement).value) as 0 | 1 | 2)">
                    <option :value="0">不置顶</option><option :value="1">版块置顶</option><option v-if="auth.isAdmin" :value="2">全局置顶</option>
                  </select>
                </label>
                <button type="button" class="v2-btn sm" :disabled="modBusy" @click="toggleLock">{{ detail.topic.isLocked ? "解锁" : "锁定" }}</button>
                <button type="button" class="v2-btn sm" :disabled="modBusy" @click="toggleDigest">{{ detail.topic.isDigest ? "取消精华" : "设为精华" }}</button>
                <label class="flex flex-col gap-1"><span class="text-[10.5px] text-muted-foreground">移动到</span>
                  <select v-model="moveCategory" class="v2-input w-36 px-2"><option value="">选择版块</option><option v-for="item in categories" :key="item.id" :value="item.id">{{ item.name }}</option></select>
                </label>
                <button type="button" class="v2-btn sm" :disabled="modBusy || !moveCategory" @click="move">移动</button>
              </div>
            </details>

            <div class="v2-topic-pager-top">
              <span>第 {{ page }} 页 / 共 {{ totalPages }} 页 · {{ total }} 楼</span>
              <PaginationBar :page="page" :total-pages="totalPages" compact @change="goPage" />
            </div>

            <div class="v2-thread">
              <PostItem :post="detail.firstPost" :can-reply="detail.viewer.canReply" :can-edit="detail.viewer.canEdit" :can-delete="detail.viewer.canDelete" :can-view-history="detail.viewer.canViewHistory" :highlight="highlightFloor === detail.firstPost.floor" @like="toggleLike" @reply="replyToPost" @quote="quote" @delete="removePost" @edit="startEdit" @history="openHistory" />
              <template v-for="post in topLevel" :key="post.id">
                <PostItem :post="post" :can-reply="detail.viewer.canReply" :can-edit="canEdit(post)" :can-delete="canDelete(post)" :can-view-history="detail.viewer.canViewHistory" :highlight="highlightFloor === post.floor" @like="toggleLike" @reply="replyToPost" @quote="quote" @delete="removePost" @edit="startEdit" @history="openHistory" />
                <PostItem v-for="child in children.get(post.id) ?? []" :key="child.id" :post="child" nested :can-reply="false" :can-edit="canEdit(child)" :can-delete="canDelete(child)" :can-view-history="detail.viewer.canViewHistory" :highlight="highlightFloor === child.floor" @like="toggleLike" @reply="replyToPost" @quote="quote" @delete="removePost" @edit="startEdit" @history="openHistory" />
              </template>
            </div>

            <div class="flex items-center justify-center border-t border-line py-3">
              <PaginationBar :page="page" :total-pages="totalPages" :total="total" unit="楼" @change="goPage" />
            </div>

            <section v-if="editingReply" id="reply-edit" class="v2-editor">
              <div class="v2-ed-head">编辑 #{{ editingReply.floor }}<span>版本 {{ editingReply.version }}</span></div>
              <div class="p-3">
                <MarkdownEditor v-model="editContent" :rows="6" />
                <input v-model="editReason" class="v2-input mt-2" maxlength="200" placeholder="编辑原因（可选）" />
                <ErrorState v-if="editError" class="mt-2" :message="editError" />
                <div class="mt-2 flex gap-2"><button type="button" class="v2-btn solid sm" :disabled="savingEdit" @click="saveReplyEdit">{{ savingEdit ? "保存中…" : "保存" }}</button><button type="button" class="v2-btn sm" @click="cancelEdit">取消</button></div>
              </div>
            </section>

            <section id="reply-editor" class="v2-editor">
              <div class="v2-ed-head">回复主题<span v-if="replyTo">回复 #{{ replyTo.floor }}</span></div>
              <template v-if="detail.viewer.canReply">
                <MarkdownEditor v-model="replyContent" :rows="3" :height="88" flat placeholder="写下你的回复…" />
                <div v-if="turnstileEnabled" class="px-3">
                  <TurnstileWidget ref="widget" :site-key="config.turnstileSiteKey" action="post_create" @token="token = $event" @expired="token = ''" @error="actionError = $event" />
                </div>
                <div class="v2-ed-foot">
                  <span class="v2-hint">请勿发布广告或与主题无关的内容。</span>
                  <span class="ml-auto" />
                  <button v-if="replyTo" type="button" class="v2-btn sm" @click="replyTo = null">取消回复</button>
                  <button type="button" class="v2-btn solid sm" :disabled="submitting" @click="submitReply">{{ submitting ? "发送中…" : "发表回复" }}</button>
                </div>
              </template>
              <div v-else class="border-t border-line p-4 text-[12px] text-muted-foreground">
                <template v-if="detail.topic.isLocked">主题已锁定，不再接受新回复。</template>
                <template v-else-if="!auth.user"><RouterLink to="/login" class="text-link">登录</RouterLink> 后参与回复。</template>
                <template v-else>回复需要已验证邮箱。<RouterLink to="/me" class="text-link">前往验证</RouterLink></template>
              </div>
            </section>
          </div>
        </div>
      </template>
    </div>
  </main>
</template>
