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
import { t } from "@/i18n";
import { api } from "@/lib/api";
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
    editError.value = t("topic.contentRequired");
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
    editError.value = config.describeError(cause, "common.saveFailed");
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
    if (seq === loadSeq) error.value = config.describeError(cause, "topic.topicLoadFailed");
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
  // Quoting is a normal new floor; only "reply" nests under an existing floor.
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
    actionError.value = t("topic.replyRequired");
    return;
  }
  if (turnstileEnabled.value && !token.value) {
    widget.value?.show();
    actionError.value = t("topic.captchaRequired");
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
    actionError.value = config.describeError(cause, "topic.replyFailed");
    if (cause && typeof cause === "object" && "code" in cause) {
      const code = String((cause as { code: unknown }).code);
      if (code === "captcha_failed" || code === "captcha_unavailable") {
        widget.value?.reset();
        token.value = "";
      }
    }
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
    actionError.value = config.describeError(cause, "topic.likeFailed");
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
    actionError.value = config.describeError(cause, "topic.bookmarkFailed");
  } finally {
    bookmarking.value = false;
  }
}

async function removeTopic(): Promise<void> {
  if (!(await confirmDialog({
    title: t("topic.deleteTopicConfirmTitle"),
    message: t("topic.deleteTopicConfirmBody"),
    confirmLabel: t("topic.confirmDelete"),
    danger: true,
  }))) return;
  try {
    await api.deleteTopic(topicId.value);
    await router.push("/");
  } catch (cause) {
    actionError.value = config.describeError(cause, "common.deleteFailed");
  }
}

async function removePost(post: Post): Promise<void> {
  if (post.isFirst) return removeTopic();
  if (!(await confirmDialog({
    title: t("topic.deleteReplyConfirmTitle"),
    message: t("topic.deleteReplyConfirmBody"),
    confirmLabel: t("topic.confirmDelete"),
    danger: true,
  }))) return;
  try {
    await api.deletePost(post.id);
    await load();
  } catch (cause) {
    actionError.value = config.describeError(cause, "common.deleteFailed");
  }
}

async function setPin(level: 0 | 1 | 2): Promise<void> {
  modBusy.value = true;
  try {
    await api.pinTopic(topicId.value, level);
    detail.value = await api.topic(topicId.value);
    pinLevel.value = level;
  } catch (cause) {
    actionError.value = config.describeError(cause, "topic.pinFailed");
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
    actionError.value = config.describeError(cause, "topic.failed");
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
    actionError.value = config.describeError(cause, "topic.featureFailed");
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
    actionError.value = config.describeError(cause, "topic.moveFailed");
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
                <RouterLink to="/">{{ t("page.home") }}</RouterLink><span class="sep">/</span><i /><RouterLink :to="`/c/${detail.topic.category.slug}`" class="v2-catlink">{{ detail.topic.category.name }}</RouterLink>
              </nav>

              <header class="v2-topic-head mt-2" :class="categoryClass(detail.topic.category.slug)" :style="categoryStyle(detail.topic.category.color)">
                <div class="min-w-0 flex-1">
                  <h1>{{ detail.topic.title }}</h1>
                  <div class="v2-tmeta">
                    <RouterLink v-if="detail.topic.author.username" :to="`/u/${detail.topic.author.username}`"><b>{{ detail.topic.author.name }}</b></RouterLink>
                    <span class="v2-dot" />
                    <span><RelativeTime :seconds="detail.topic.createdAt" /></span><span class="v2-dot" /><span>{{ t("topic.replyCount", { count: detail.topic.replyCount }) }}</span><span class="v2-dot" /><span>{{ t("topic.viewCount", { count: detail.topic.viewCount }) }}</span>
                    <span v-if="detail.topic.isLocked" class="text-[var(--orange)]">{{ t("topic.locked") }}</span>
                  </div>
                  <div v-if="detail.topic.tags.length" class="mt-2"><TagChips :tags="detail.topic.tags" /></div>
                </div>
                <div class="flex flex-none flex-wrap items-center gap-2">
                  <button type="button" class="v2-switch" role="switch" :aria-checked="onlyOp" @click="toggleOnlyOp">
                    <span class="v2-switch-track" aria-hidden="true" />{{ t("topic.onlyOp") }}
                  </button>
                  <button v-if="auth.user" type="button" class="v2-btn sm" @click="toggleBookmark">{{ detail.viewer.bookmarked ? t("topic.bookmarked") : t("topic.bookmark") }}</button>
                  <details v-if="auth.user" class="v2-actions-menu">
                    <summary class="v2-btn sm" :aria-label="t('topic.actions')"><MoreHorizontal :size="14" /></summary>
                    <div class="v2-dropdown">
                      <RouterLink v-if="detail.viewer.canEdit" :to="`/t/${detail.topic.id}/edit`"><Pencil :size="13" />{{ t("topic.editTopic") }}</RouterLink>
                      <button v-if="detail.viewer.canViewHistory" type="button" @click="openHistory(detail.firstPost)"><History :size="13" />{{ t("topic.revisions") }}</button>
                      <span class="v2-dropdown-sep" />
                      <button v-if="detail.viewer.canDelete" type="button" class="danger" @click="removeTopic"><Trash2 :size="13" />{{ t("topic.deleteTopic") }}</button>
                    </div>
                  </details>
                </div>
              </header>
            </div>

            <div v-if="actionError" class="fixed inset-x-4 bottom-4 z-[70] mx-auto max-w-md border border-orange/40 bg-card px-3 py-2 text-[11.5px] text-ink shadow-lg" role="alert">
              <span class="mr-2">{{ actionError }}</span>
              <button type="button" class="text-muted-foreground hover:text-ink" @click="actionError = ''">{{ t("topic.actionClose") }}</button>
            </div>

            <details v-if="detail.viewer.canModerate" class="v2-panel mb-3 mt-3 p-3">
              <summary class="cursor-pointer text-[12px] font-medium">{{ t("topic.moderation") }}</summary>
              <div class="v2-inline-controls mt-3 items-end text-[12px]">
                <label class="flex flex-col gap-1"><span class="text-[10.5px] text-muted-foreground">{{ t("topic.pinLabel") }}</span>
                  <select :value="pinLevel" class="v2-input w-28 px-2" :disabled="modBusy" @change="setPin(Number(($event.target as HTMLSelectElement).value) as 0 | 1 | 2)">
                    <option :value="0">{{ t("topic.noPin") }}</option><option :value="1">{{ t("topic.categoryPin") }}</option><option v-if="auth.isAdmin" :value="2">{{ t("topic.globalPin") }}</option>
                  </select>
                </label>
                <button type="button" class="v2-btn sm" :disabled="modBusy" @click="toggleLock">{{ detail.topic.isLocked ? t("topic.unlock") : t("topic.lock") }}</button>
                <button type="button" class="v2-btn sm" :disabled="modBusy" @click="toggleDigest">{{ detail.topic.isDigest ? t("topic.unfeature") : t("topic.feature") }}</button>
                <label class="flex flex-col gap-1"><span class="text-[10.5px] text-muted-foreground">{{ t("topic.moveTo") }}</span>
                  <select v-model="moveCategory" class="v2-input w-36 px-2"><option value="">{{ t("topic.chooseCategory") }}</option><option v-for="item in categories" :key="item.id" :value="item.id">{{ item.name }}</option></select>
                </label>
                <button type="button" class="v2-btn sm" :disabled="modBusy || !moveCategory" @click="move">{{ t("topic.move") }}</button>
              </div>
            </details>

            <div class="v2-topic-pager-top">
              <span>{{ t("topic.pageInfo", { page, pages: totalPages, total }) }}</span>
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
              <PaginationBar :page="page" :total-pages="totalPages" :total="total" :unit="t('topic.floors')" @change="goPage" />
            </div>

            <section v-if="editingReply" id="reply-edit" class="v2-editor">
              <div class="v2-ed-head">{{ t("topic.editHead", { floor: editingReply.floor }) }}<span>{{ t("topic.version", { version: editingReply.version }) }}</span></div>
              <div class="p-3">
                <MarkdownEditor v-model="editContent" :rows="6" />
                <input v-model="editReason" class="v2-input mt-2" maxlength="200" :placeholder="t('topic.editReasonPlaceholder')" />
                <ErrorState v-if="editError" class="mt-2" :message="editError" />
                <div class="mt-2 flex gap-2"><button type="button" class="v2-btn solid sm" :disabled="savingEdit" @click="saveReplyEdit">{{ savingEdit ? t("common.saving") : t("topic.saveReplyEdit") }}</button><button type="button" class="v2-btn sm" @click="cancelEdit">{{ t("common.cancel") }}</button></div>
              </div>
            </section>

            <section id="reply-editor" class="v2-editor">
              <div class="v2-ed-head">{{ t("topic.replyTitle") }}<span v-if="replyTo">{{ t("topic.replyTo", { floor: replyTo.floor }) }}</span></div>
              <template v-if="detail.viewer.canReply">
                <MarkdownEditor v-model="replyContent" :rows="3" :height="88" flat :placeholder="t('topic.replyPlaceholder')" />
                <div v-if="turnstileEnabled" class="px-3">
                  <TurnstileWidget ref="widget" :site-key="config.turnstileSiteKey" action="post_create" @token="token = $event" @expired="token = ''" @error="actionError = $event" />
                </div>
                <div class="v2-ed-foot">
                  <span class="v2-hint">{{ t("topic.replyHint") }}</span>
                  <span class="ml-auto" />
                  <button v-if="replyTo" type="button" class="v2-btn sm" @click="replyTo = null">{{ t("topic.cancelReply") }}</button>
                  <button type="button" class="v2-btn solid sm" :disabled="submitting" @click="submitReply">{{ submitting ? t("topic.replying") : t("topic.submitReply") }}</button>
                </div>
              </template>
              <div v-else class="border-t border-line p-4 text-[12px] text-muted-foreground">
                <template v-if="detail.topic.isLocked">{{ t("topic.lockedNoReply") }}</template>
                <template v-else-if="!auth.user"><RouterLink to="/login" class="text-link">{{ t("topic.loginToReply") }}</RouterLink> {{ t("topic.loginToReplySuffix") }}</template>
                <template v-else>{{ t("topic.verifyNeeded") }} <RouterLink to="/me" class="text-link">{{ t("topic.goVerify") }}</RouterLink></template>
              </div>
            </section>
          </div>
        </div>
      </template>
    </div>
  </main>
</template>
