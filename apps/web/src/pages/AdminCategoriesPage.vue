<script setup lang="ts">
import type { AdminCategory, CategoryInput } from "@pineboard/shared";
import { confirmDialog } from "@/lib/confirm";
import { ArrowDown, ArrowUp, Eye, EyeOff, Pencil, Plus, Trash2, UserMinus, Users, X } from "lucide-vue-next";
import { onMounted, reactive, ref } from "vue";
import { api, ApiClientError } from "@/lib/api";
import { alertErrorClass, alertInfoClass, inputClass, labelClass } from "@/lib/ui";

const categories = ref<AdminCategory[]>([]);
const loading = ref(true);
const busy = ref("");
const error = ref("");
const saved = ref("");
const formOpen = ref(false);
const editing = ref<AdminCategory | null>(null);
const moderatorFor = ref<AdminCategory | null>(null);
const moderatorInput = ref("");
const moderatorBusy = ref("");
const moderatorError = ref("");
const form = reactive<CategoryInput>({
  slug: "",
  name: "",
  description: "",
  color: "#14513f",
  sortOrder: 0,
  isVisible: true,
});

function resetForm(): void {
  editing.value = null;
  form.slug = "";
  form.name = "";
  form.description = "";
  form.color = "#14513f";
  form.sortOrder = (categories.value.at(-1)?.sortOrder ?? 0) + 10;
  form.isVisible = true;
}

function openCreate(): void {
  error.value = "";
  saved.value = "";
  resetForm();
  formOpen.value = true;
}

function openEdit(category: AdminCategory): void {
  error.value = "";
  saved.value = "";
  editing.value = category;
  form.slug = category.slug;
  form.name = category.name;
  form.description = category.description;
  form.color = category.color;
  form.sortOrder = category.sortOrder;
  form.isVisible = category.isVisible;
  formOpen.value = true;
}

function syncModeratorPanel(): void {
  if (!moderatorFor.value) return;
  moderatorFor.value = categories.value.find((item) => item.id === moderatorFor.value!.id) ?? null;
}

function openModerators(category: AdminCategory): void {
  moderatorFor.value = category;
  moderatorInput.value = "";
  moderatorError.value = "";
}

async function addModerator(): Promise<void> {
  if (!moderatorFor.value || !moderatorInput.value.trim()) return;
  moderatorBusy.value = "add";
  moderatorError.value = "";
  saved.value = "";
  try {
    categories.value = await api.addCategoryModerator(moderatorFor.value.id, moderatorInput.value.trim());
    syncModeratorPanel();
    moderatorInput.value = "";
    saved.value = "版主已添加；普通用户会自动提升为版主角色。";
  } catch (cause) {
    moderatorError.value = cause instanceof ApiClientError ? cause.message : "添加版主失败";
  } finally {
    moderatorBusy.value = "";
  }
}

async function removeModerator(userId: string, name: string): Promise<void> {
  if (!moderatorFor.value) return;
  if (!(await confirmDialog({ title: "移除版主", message: `移除版主「${name}」？如果 TA 没有其他版块，会自动回退为普通用户。`, confirmLabel: "移除", danger: true }))) return;
  moderatorBusy.value = `remove:${userId}`;
  moderatorError.value = "";
  saved.value = "";
  try {
    categories.value = await api.removeCategoryModerator(moderatorFor.value.id, userId);
    syncModeratorPanel();
    saved.value = `已移除版主「${name}」。`;
  } catch (cause) {
    moderatorError.value = cause instanceof ApiClientError ? cause.message : "移除版主失败";
  } finally {
    moderatorBusy.value = "";
  }
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    categories.value = await api.adminCategories();
    syncModeratorPanel();
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? cause.message : "加载版块失败";
  } finally {
    loading.value = false;
  }
}

async function save(): Promise<void> {
  if (!form.name.trim() || !form.slug.trim()) {
    error.value = "版块名称和 slug 都不能为空";
    return;
  }
  busy.value = "save";
  error.value = "";
  saved.value = "";
  try {
    if (editing.value) {
      await api.updateAdminCategory(editing.value.id, { ...form });
      saved.value = `已更新「${form.name}」。`;
    } else {
      await api.createAdminCategory({ ...form, slug: form.slug.trim().toLowerCase() });
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

async function toggleVisible(category: AdminCategory): Promise<void> {
  busy.value = `visible:${category.id}`;
  error.value = "";
  try {
    await api.updateAdminCategory(category.id, {
      slug: category.slug,
      name: category.name,
      description: category.description,
      color: category.color,
      sortOrder: category.sortOrder,
      isVisible: !category.isVisible,
    });
    await load();
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? cause.message : "更新失败";
  } finally {
    busy.value = "";
  }
}

async function move(category: AdminCategory, direction: -1 | 1): Promise<void> {
  const index = categories.value.findIndex((item) => item.id === category.id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= categories.value.length) return;
  const next = [...categories.value];
  [next[index], next[target]] = [next[target]!, next[index]!];
  busy.value = "reorder";
  error.value = "";
  try {
    categories.value = await api.reorderAdminCategories(next.map((item) => item.id));
    saved.value = "排序已更新。";
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? cause.message : "排序失败";
  } finally {
    busy.value = "";
  }
}

async function remove(category: AdminCategory): Promise<void> {
  if (!(await confirmDialog({ title: "删除版块", message: `删除版块「${category.name}」？只有没有主题的版块可以删除。`, confirmLabel: "删除", danger: true }))) return;
  busy.value = `delete:${category.id}`;
  error.value = "";
  saved.value = "";
  try {
    await api.deleteAdminCategory(category.id);
    saved.value = `已删除「${category.name}」。`;
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
        <h1 class="text-[19px] font-bold leading-[1.3]">版块维护</h1>
        <p class="mt-1 text-[10.5px] text-muted-foreground">管理版块名称、颜色、可见性与顺序；有主题的版块不能删除。</p>
      </div>
      <button type="button" class="v2-btn solid sm" @click="openCreate"><Plus :size="13" /> 新建版块</button>
    </div>

    <p v-if="error" :class="[alertErrorClass, 'mt-4']">{{ error }}</p>
    <p v-if="saved" :class="[alertInfoClass, 'mt-4']">{{ saved }}</p>

    <section v-if="formOpen" class="v2-admin-panel mt-4">
      <div class="v2-admin-panel-head">
        <span>{{ editing ? `编辑「${editing.name}」` : "新建版块" }}</span>
        <button type="button" class="text-muted-foreground hover:text-ink" aria-label="关闭" @click="formOpen = false"><X :size="15" /></button>
      </div>
      <form class="p-4" @submit.prevent="save">
        <div class="grid gap-3 sm:grid-cols-2">
          <div>
            <label :class="labelClass" for="category-name">名称</label>
            <input id="category-name" v-model="form.name" :class="inputClass" maxlength="40" placeholder="例如：工具与效率" />
          </div>
          <div>
            <label :class="labelClass" for="category-slug">Slug</label>
            <input id="category-slug" v-model="form.slug" :class="inputClass" maxlength="40" placeholder="tools" />
            <p class="mt-1 text-[10px] text-muted-foreground">用于 /c/&lt;slug&gt;，只能是小写字母、数字和短横线。</p>
          </div>
          <div class="sm:col-span-2">
            <label :class="labelClass" for="category-description">说明</label>
            <input id="category-description" v-model="form.description" :class="inputClass" maxlength="200" placeholder="一句话说明这个版块讨论什么" />
          </div>
          <div>
            <label :class="labelClass" for="category-color">颜色</label>
            <div class="flex items-center gap-2">
              <input id="category-color" v-model="form.color" type="color" class="h-[38px] w-12 cursor-pointer rounded-[3px] border border-line bg-surface p-1" />
              <input v-model="form.color" :class="inputClass" maxlength="7" placeholder="#14513f" />
            </div>
          </div>
          <div class="flex items-end">
            <label class="flex items-center gap-2 pb-2 text-[12px]">
              <input v-model="form.isVisible" type="checkbox" class="size-4 accent-brand" />
              在导航与列表中显示
            </label>
          </div>
        </div>
        <div class="mt-4 flex items-center gap-2">
          <button type="submit" class="v2-btn solid sm" :disabled="busy === 'save'">{{ busy === "save" ? "保存中…" : "保存版块" }}</button>
          <button type="button" class="v2-btn sm" @click="formOpen = false">取消</button>
        </div>
      </form>
    </section>

    <section v-if="moderatorFor" class="v2-admin-panel mt-4">
      <div class="v2-admin-panel-head">
        <span>「{{ moderatorFor.name }}」版主管理</span>
        <button type="button" class="text-muted-foreground hover:text-ink" aria-label="关闭" @click="moderatorFor = null"><X :size="15" /></button>
      </div>
      <div class="p-4">
        <p class="text-[10.5px] leading-5 text-muted-foreground">版主只能管理此版块的置顶、锁帖、移动与举报；添加普通用户时会自动提升为版主角色，移除最后一个版块后会自动回退为普通用户。</p>
        <div v-if="moderatorFor.moderators.length" class="mt-3 divide-y divide-line border-y border-line">
          <div v-for="moderator in moderatorFor.moderators" :key="moderator.id" class="flex items-center gap-3 py-2">
            <span class="grid size-7 flex-none place-items-center rounded-full bg-pine/10 text-[11px] font-semibold text-pine">{{ moderator.name.slice(0, 1) }}</span>
            <div class="min-w-0 flex-1">
              <p class="truncate text-[12px] font-medium">{{ moderator.name }} <span class="font-normal text-muted-foreground">@{{ moderator.username || "—" }}</span></p>
              <p class="text-[10px] text-muted-foreground">{{ moderator.role === "admin" ? "管理员" : "版主" }}</p>
            </div>
            <button type="button" class="v2-btn sm danger" :disabled="moderatorBusy === `remove:${moderator.id}`" @click="removeModerator(moderator.id, moderator.name)"><UserMinus :size="13" /> 移除</button>
          </div>
        </div>
        <p v-else class="mt-3 border-y border-line py-3 text-[11.5px] text-muted-foreground">还没有版主。</p>
        <p v-if="moderatorError" class="v2-alert mt-3">{{ moderatorError }}</p>
        <form class="v2-inline-controls mt-3" @submit.prevent="addModerator">
          <input v-model="moderatorInput" :class="inputClass" class="max-w-xs" maxlength="254" placeholder="输入用户名或邮箱" aria-label="版主用户名或邮箱" />
          <button type="submit" class="v2-btn solid sm" :disabled="moderatorBusy === 'add' || !moderatorInput.trim()">{{ moderatorBusy === "add" ? "添加中…" : "添加版主" }}</button>
        </form>
      </div>
    </section>

    <div v-if="loading" class="v2-admin-panel mt-4 p-4">
      <div v-for="i in 4" :key="i" class="flex items-center gap-3 border-b border-line py-3 last:border-b-0">
        <div class="size-2.5 animate-pulse rounded-full bg-muted" />
        <div class="flex-1 space-y-2"><div class="h-3 w-1/3 animate-pulse bg-muted" /><div class="h-2.5 w-2/3 animate-pulse bg-muted" /></div>
      </div>
    </div>

    <section v-else class="v2-admin-panel mt-4">
      <div class="v2-admin-panel-head"><span>全部版块</span><span class="text-[10.5px] font-normal text-muted-foreground">{{ categories.length }} 个</span></div>
      <div v-if="!categories.length" class="p-6 text-center text-[11.5px] text-muted-foreground">还没有版块，先新建一个。</div>
      <div v-for="(category, index) in categories" :key="category.id" class="v2-admin-row">
        <div class="flex min-w-0 items-center gap-3">
          <span class="size-2.5 flex-none rounded-full" :style="{ background: category.color }" />
          <div class="min-w-0">
            <p class="flex flex-wrap items-center gap-2 text-[12.5px] font-semibold">
              {{ category.name }}
              <span class="font-mono text-[10px] font-normal text-muted-foreground">/c/{{ category.slug }}</span>
              <span v-if="!category.isVisible" class="v2-flag">{{ "已隐藏" }}</span>
            </p>
            <p class="mt-0.5 truncate text-[10.5px] text-muted-foreground">{{ category.description || "暂无说明" }} · {{ category.topicCount }} 个主题 · 版主：{{ category.moderators.length ? category.moderators.map((item) => item.name).join("、") : "未设置" }}</p>
          </div>
        </div>
        <div class="flex flex-none items-center gap-1">
          <button type="button" class="v2-btn sm" :disabled="index === 0 || busy === 'reorder'" aria-label="上移" @click="move(category, -1)"><ArrowUp :size="13" /></button>
          <button type="button" class="v2-btn sm" :disabled="index === categories.length - 1 || busy === 'reorder'" aria-label="下移" @click="move(category, 1)"><ArrowDown :size="13" /></button>
          <button type="button" class="v2-btn sm" :disabled="busy === `visible:${category.id}`" :aria-label="category.isVisible ? '隐藏' : '显示'" @click="toggleVisible(category)">
            <Eye v-if="category.isVisible" :size="13" />
            <EyeOff v-else :size="13" />
          </button>
          <button type="button" class="v2-btn sm" aria-label="版主管理" @click="openModerators(category)"><Users :size="13" /></button>
          <button type="button" class="v2-btn sm" aria-label="编辑" @click="openEdit(category)"><Pencil :size="13" /></button>
          <button type="button" class="v2-btn sm danger" :disabled="busy === `delete:${category.id}`" aria-label="删除" @click="remove(category)"><Trash2 :size="13" /></button>
        </div>
      </div>
    </section>
  </div>
</template>
