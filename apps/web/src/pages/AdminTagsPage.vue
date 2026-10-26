<script setup lang="ts">
import type { AdminTag, TagInput } from "@pineboard/shared";
import { confirmDialog } from "@/lib/confirm";
import { Eye, EyeOff, Pencil, Plus, Trash2, X } from "lucide-vue-next";
import { computed, onMounted, reactive, ref } from "vue";
import { api, ApiClientError } from "@/lib/api";
import { alertErrorClass, alertInfoClass, inputClass, labelClass } from "@/lib/ui";

const tags = ref<AdminTag[]>([]);
const loading = ref(true);
const busy = ref("");
const error = ref("");
const saved = ref("");
const query = ref("");
const formOpen = ref(false);
const editing = ref<AdminTag | null>(null);
const form = reactive<TagInput>({
  slug: "",
  name: "",
  description: "",
  color: "#71717a",
  status: "active",
});

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return tags.value;
  return tags.value.filter((tag) => tag.name.toLowerCase().includes(q) || tag.slug.includes(q));
});

const statusLabel: Record<string, string> = { active: "显示中", hidden: "已隐藏", merged: "已合并" };

function resetForm(): void {
  editing.value = null;
  form.slug = "";
  form.name = "";
  form.description = "";
  form.color = "#71717a";
  form.status = "active";
}

function openCreate(): void {
  error.value = "";
  saved.value = "";
  resetForm();
  formOpen.value = true;
}

function openEdit(tag: AdminTag): void {
  error.value = "";
  saved.value = "";
  editing.value = tag;
  form.slug = tag.slug;
  form.name = tag.name;
  form.description = tag.description;
  form.color = tag.color;
  form.status = tag.status;
  formOpen.value = true;
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    tags.value = await api.adminTags();
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? cause.message : "加载标签失败";
  } finally {
    loading.value = false;
  }
}

async function save(): Promise<void> {
  if (!form.name.trim() || !form.slug.trim()) {
    error.value = "标签名称和 slug 都不能为空";
    return;
  }
  busy.value = "save";
  error.value = "";
  saved.value = "";
  try {
    if (editing.value) {
      await api.updateAdminTag(editing.value.id, { ...form, slug: form.slug.trim().toLowerCase() });
      saved.value = `已更新「${form.name}」。`;
    } else {
      await api.createAdminTag({ ...form, slug: form.slug.trim().toLowerCase() });
      saved.value = `已创建「${form.name}」。`;
    }
    formOpen.value = false;
    editing.value = null;
    await load();
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? cause.message : "保存失败";
  } finally {
    busy.value = "";
  }
}

async function toggleStatus(tag: AdminTag): Promise<void> {
  busy.value = `status:${tag.id}`;
  error.value = "";
  try {
    await api.updateAdminTag(tag.id, {
      slug: tag.slug,
      name: tag.name,
      description: tag.description,
      color: tag.color,
      status: tag.status === "active" ? "hidden" : "active",
    });
    await load();
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? cause.message : "更新失败";
  } finally {
    busy.value = "";
  }
}

async function remove(tag: AdminTag): Promise<void> {
  if (!(await confirmDialog({ title: "删除标签", message: `删除标签「${tag.name}」？仍被主题使用的标签不能删除。`, confirmLabel: "删除", danger: true }))) return;
  busy.value = `delete:${tag.id}`;
  error.value = "";
  saved.value = "";
  try {
    await api.deleteAdminTag(tag.id);
    saved.value = `已删除「${tag.name}」。`;
    await load();
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? cause.message : "删除失败";
  } finally {
    busy.value = "";
  }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
      <div>
        <h1 class="text-[19px] font-bold leading-[1.3]">标签维护</h1>
        <p class="mt-1 text-[10.5px] text-muted-foreground">维护标签名称、slug、颜色与可见性；仍被主题使用的标签不能删除。</p>
      </div>
      <div class="v2-inline-controls">
        <input v-model="query" class="v2-input w-40 text-[11.5px]" type="search" placeholder="搜索标签" aria-label="搜索标签" />
        <button type="button" class="v2-btn solid sm" @click="openCreate"><Plus :size="13" /> 新建标签</button>
      </div>
    </div>

    <p v-if="error" :class="[alertErrorClass, 'mt-4']">{{ error }}</p>
    <p v-if="saved" :class="[alertInfoClass, 'mt-4']">{{ saved }}</p>

    <section v-if="formOpen" class="v2-admin-panel mt-4">
      <div class="v2-admin-panel-head">
        <span>{{ editing ? `编辑「${editing.name}」` : "新建标签" }}</span>
        <button type="button" class="text-muted-foreground hover:text-ink" aria-label="关闭" @click="formOpen = false"><X :size="15" /></button>
      </div>
      <form class="p-4" @submit.prevent="save">
        <div class="grid gap-3 sm:grid-cols-2">
          <div>
            <label :class="labelClass" for="tag-name">名称</label>
            <input id="tag-name" v-model="form.name" :class="inputClass" maxlength="30" placeholder="例如：攻略" />
          </div>
          <div>
            <label :class="labelClass" for="tag-slug">Slug</label>
            <input id="tag-slug" v-model="form.slug" :class="inputClass" maxlength="40" placeholder="guide" />
            <p class="mt-1 text-[10px] text-muted-foreground">用于 /tag/&lt;slug&gt;，只能是小写字母、数字和短横线。</p>
          </div>
          <div class="sm:col-span-2">
            <label :class="labelClass" for="tag-description">说明</label>
            <input id="tag-description" v-model="form.description" :class="inputClass" maxlength="200" placeholder="一句话说明这个标签的用途" />
          </div>
          <div>
            <label :class="labelClass" for="tag-color">颜色</label>
            <div class="flex items-center gap-2">
              <input id="tag-color" v-model="form.color" type="color" class="h-[38px] w-12 cursor-pointer rounded-[3px] border border-line bg-surface p-1" />
              <input v-model="form.color" :class="inputClass" maxlength="7" placeholder="#71717a" />
            </div>
          </div>
          <div>
            <label :class="labelClass" for="tag-status">状态</label>
            <select id="tag-status" v-model="form.status" :class="inputClass">
              <option value="active">显示</option>
              <option value="hidden">隐藏</option>
              <option value="merged">已合并（仅历史）</option>
            </select>
          </div>
        </div>
        <div class="mt-4 flex items-center gap-2">
          <button type="submit" class="v2-btn solid sm" :disabled="busy === 'save'">{{ busy === "save" ? "保存中…" : "保存标签" }}</button>
          <button type="button" class="v2-btn sm" @click="formOpen = false">取消</button>
        </div>
      </form>
    </section>

    <div v-if="loading" class="v2-admin-panel mt-4 p-4">
      <div v-for="i in 5" :key="i" class="flex items-center gap-3 border-b border-line py-3 last:border-b-0">
        <div class="size-2.5 animate-pulse rounded-full bg-muted" />
        <div class="flex-1 space-y-2"><div class="h-3 w-1/4 animate-pulse bg-muted" /><div class="h-2.5 w-1/2 animate-pulse bg-muted" /></div>
      </div>
    </div>

    <section v-else class="v2-admin-panel mt-4">
      <div class="v2-admin-panel-head"><span>全部标签</span><span class="text-[10.5px] font-normal text-muted-foreground">{{ filtered.length }} 个</span></div>
      <div v-if="!filtered.length" class="p-6 text-center text-[11.5px] text-muted-foreground">{{ query ? "没有匹配的标签。" : "还没有标签，先新建一个。" }}</div>
      <div v-for="tag in filtered" :key="tag.id" class="v2-admin-row">
        <div class="flex min-w-0 items-center gap-3">
          <span class="size-2.5 flex-none rounded-full" :style="{ background: tag.color }" />
          <div class="min-w-0">
            <p class="flex flex-wrap items-center gap-2 text-[12.5px] font-semibold">
              <span class="text-pine">#</span>{{ tag.name }}
              <span class="font-mono text-[10px] font-normal text-muted-foreground">/tag/{{ tag.slug }}</span>
              <span class="v2-status-pill" :class="tag.status">{{ statusLabel[tag.status] }}</span>
            </p>
            <p class="mt-0.5 truncate text-[10.5px] text-muted-foreground">{{ tag.description || "暂无说明" }} · {{ tag.topicCount }} 个主题使用</p>
          </div>
        </div>
        <div class="flex flex-none items-center gap-1">
          <button type="button" class="v2-btn sm" :disabled="busy === `status:${tag.id}`" :aria-label="tag.status === 'active' ? '隐藏' : '显示'" @click="toggleStatus(tag)">
            <Eye v-if="tag.status === 'active'" :size="13" />
            <EyeOff v-else :size="13" />
          </button>
          <button type="button" class="v2-btn sm" aria-label="编辑" @click="openEdit(tag)"><Pencil :size="13" /></button>
          <button
            type="button"
            class="v2-btn sm danger"
            :disabled="busy === `delete:${tag.id}` || tag.topicCount > 0"
            :title="tag.topicCount > 0 ? '该标签仍被主题使用' : '删除标签'"
            aria-label="删除"
            @click="remove(tag)"
          >
            <Trash2 :size="13" />
          </button>
        </div>
      </div>
    </section>
  </div>
</template>
