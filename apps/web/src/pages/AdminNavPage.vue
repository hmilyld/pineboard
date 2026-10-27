<script setup lang="ts">
import type { NavItem, NavItemInput } from "@pineboard/shared";
import { confirmDialog } from "@/lib/confirm";
import { ArrowDown, ArrowUp, Eye, EyeOff, Pencil, Plus, Trash2, X } from "lucide-vue-next";
import { computed, onMounted, reactive, ref } from "vue";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { alertErrorClass, alertInfoClass, inputClass, labelClass } from "@/lib/ui";
import { useConfigStore } from "@/stores/config";

const config = useConfigStore();
const items = ref<NavItem[]>([]);
const loading = ref(true);
const busy = ref("");
const error = ref("");
const saved = ref("");
const formOpen = ref(false);
const editing = ref<NavItem | null>(null);
const navRows = computed(() => {
  const ordered = [...items.value].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  const topLevel = ordered.filter((item) => !item.parentId);
  const rows: Array<NavItem & { depth: number }> = [];
  for (const parent of topLevel) {
    rows.push({ ...parent, depth: 0 });
    for (const child of ordered.filter((item) => item.parentId === parent.id)) rows.push({ ...child, depth: 1 });
  }
  for (const orphan of ordered.filter((item) => item.parentId && !topLevel.some((parent) => parent.id === item.parentId))) {
    rows.push({ ...orphan, depth: 1 });
  }
  return rows;
});

const form = reactive<NavItemInput>({
  label: "",
  href: "",
  kind: "link",
  parentId: null,
  sortOrder: 0,
  isVisible: true,
  openInNewTab: false,
});

function resetForm(): void {
  editing.value = null;
  form.label = "";
  form.href = "";
  form.kind = "link";
  form.parentId = null;
  form.sortOrder = (items.value.at(-1)?.sortOrder ?? 0) + 10;
  form.isVisible = true;
  form.openInNewTab = false;
}

function openCreate(): void {
  error.value = "";
  saved.value = "";
  resetForm();
  formOpen.value = true;
}

function openEdit(item: NavItem): void {
  error.value = "";
  saved.value = "";
  editing.value = item;
  form.label = item.label;
  form.href = item.href;
  form.kind = item.kind;
  form.parentId = item.parentId ?? null;
  form.sortOrder = item.sortOrder;
  form.isVisible = item.isVisible;
  form.openInNewTab = item.openInNewTab;
  formOpen.value = true;
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    items.value = await api.adminNav();
  } catch (cause) {
    error.value = config.describeError(cause, "admin.navPage.loadFailed");
  } finally {
    loading.value = false;
  }
}

async function save(): Promise<void> {
  if (!form.label.trim()) {
    error.value = t("admin.navPage.labelRequired");
    return;
  }
  if (form.kind === "link" && !form.href.trim()) {
    error.value = t("admin.navPage.hrefRequired");
    return;
  }
  if (form.parentId && form.kind !== "link") {
    error.value = t("admin.navPage.parentOnlyLink");
    return;
  }
  busy.value = "save";
  error.value = "";
  saved.value = "";
  try {
    const payload = { ...form, href: form.kind === "link" ? form.href.trim() : "", parentId: form.parentId || null };
    if (editing.value) {
      await api.updateAdminNav(editing.value.id, payload);
      saved.value = t("admin.navPage.updated", { label: form.label });
    } else {
      await api.createAdminNav(payload);
      saved.value = t("admin.navPage.added", { label: form.label });
    }
    formOpen.value = false;
    editing.value = null;
    await load();
  } catch (cause) {
    error.value = config.describeError(cause, "common.saveFailed");
  } finally {
    busy.value = "";
  }
}

async function toggleVisible(item: NavItem): Promise<void> {
  busy.value = `visible:${item.id}`;
  error.value = "";
  try {
    await api.updateAdminNav(item.id, {
      label: item.label,
      href: item.href,
      kind: item.kind,
      parentId: item.parentId,
      sortOrder: item.sortOrder,
      isVisible: !item.isVisible,
      openInNewTab: item.openInNewTab,
    });
    await load();
  } catch (cause) {
    error.value = config.describeError(cause, "common.updateFailed");
  } finally {
    busy.value = "";
  }
}

async function move(item: NavItem, direction: -1 | 1): Promise<void> {
  const index = items.value.findIndex((entry) => entry.id === item.id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= items.value.length) return;
  const next = [...items.value];
  [next[index], next[target]] = [next[target]!, next[index]!];
  busy.value = "reorder";
  error.value = "";
  try {
    items.value = await api.reorderAdminNav(next.map((entry) => entry.id));
    saved.value = t("admin.navPage.reordered");
  } catch (cause) {
    error.value = config.describeError(cause, "admin.categories.reorderFailed");
  } finally {
    busy.value = "";
  }
}

async function remove(item: NavItem): Promise<void> {
  const childCount = items.value.filter((entry) => entry.parentId === item.id).length;
  if (!(await confirmDialog({
    title: t("admin.navPage.deleteTitle"),
    message: childCount ? t("admin.navPage.deleteWithChildren", { label: item.label, count: childCount }) : t("admin.navPage.deleteBody", { label: item.label }),
    confirmLabel: t("admin.common.delete"),
    danger: true,
  }))) return;
  busy.value = `delete:${item.id}`;
  error.value = "";
  saved.value = "";
  try {
    await api.deleteAdminNav(item.id);
    saved.value = t("admin.navPage.deleted", { label: item.label });
    await load();
  } catch (cause) {
    error.value = config.describeError(cause, "common.deleteFailed");
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
        <h1 class="text-[19px] font-bold leading-[1.3]">{{ t("admin.nav.nav") }}</h1>
        <p class="mt-1 text-[10.5px] text-muted-foreground">{{ t("admin.navPage.subtitle") }}</p>
      </div>
      <button type="button" class="v2-btn solid sm" @click="openCreate"><Plus :size="13" /> {{ t("admin.navPage.create") }}</button>
    </div>

    <p v-if="error" :class="[alertErrorClass, 'mt-4']">{{ error }}</p>
    <p v-if="saved" :class="[alertInfoClass, 'mt-4']">{{ saved }}</p>

    <section v-if="formOpen" class="v2-admin-panel mt-4">
      <div class="v2-admin-panel-head">
        <span>{{ editing ? t("admin.navPage.editTitle", { label: editing.label }) : t("admin.navPage.create") }}</span>
        <button type="button" class="text-muted-foreground hover:text-ink" :aria-label="t('admin.common.close')" @click="formOpen = false"><X :size="15" /></button>
      </div>
      <form class="p-4" @submit.prevent="save">
        <div class="grid gap-3 sm:grid-cols-2">
          <div>
            <label :class="labelClass" for="nav-label">{{ t("admin.common.name") }}</label>
            <input id="nav-label" v-model="form.label" :class="inputClass" maxlength="20" :placeholder="t('admin.navPage.labelPlaceholder')" />
          </div>
          <div>
            <label :class="labelClass" for="nav-kind">{{ t("admin.navPage.kind") }}</label>
            <select id="nav-kind" v-model="form.kind" :class="inputClass">
              <option value="link">{{ t("admin.navPage.kindLink") }}</option>
              <option value="categories">{{ t("admin.navPage.kindCategories") }}</option>
              <option value="dropdown">{{ t("admin.navPage.kindDropdown") }}</option>
            </select>
          </div>
          <div v-if="form.kind === 'link'" class="sm:col-span-2">
            <label :class="labelClass" for="nav-parent">{{ t("admin.navPage.parent") }}</label>
            <select id="nav-parent" v-model="form.parentId" :class="inputClass">
              <option :value="null">{{ t("admin.navPage.noParent") }}</option>
              <option v-for="parent in items.filter((entry) => entry.kind === 'dropdown' && !entry.parentId && entry.id !== editing?.id)" :key="parent.id" :value="parent.id">{{ parent.label }}</option>
            </select>
          </div>
          <div v-if="form.kind === 'link'" class="sm:col-span-2">
            <label :class="labelClass" for="nav-href">{{ t("admin.navPage.href") }}</label>
            <input id="nav-href" v-model="form.href" :class="inputClass" maxlength="300" :placeholder="t('admin.navPage.hrefPlaceholder')" />
          </div>
          <div v-else class="sm:col-span-2">
            <p v-if="form.kind === 'categories'" class="v2-note">{{ t("admin.navPage.categoriesNote") }}</p>
            <p v-else class="v2-note">{{ t("admin.navPage.dropdownNote") }}</p>
          </div>
          <div class="flex items-end gap-4 pb-2">
            <label class="flex items-center gap-2 text-[12px]"><input v-model="form.isVisible" type="checkbox" class="size-4 accent-brand" /> {{ t("admin.common.show") }}</label>
            <label v-if="form.kind === 'link'" class="flex items-center gap-2 text-[12px]"><input v-model="form.openInNewTab" type="checkbox" class="size-4 accent-brand" /> {{ t("admin.navPage.newTab") }}</label>
          </div>
        </div>
        <div class="mt-4 flex items-center gap-2">
          <button type="submit" class="v2-btn solid sm" :disabled="busy === 'save'">{{ busy === "save" ? t("admin.common.saving") : t("admin.navPage.save") }}</button>
          <button type="button" class="v2-btn sm" @click="formOpen = false">{{ t("admin.common.cancel") }}</button>
        </div>
      </form>
    </section>

    <div v-if="loading" class="v2-admin-panel mt-4 p-4">
      <div v-for="i in 4" :key="i" class="flex items-center gap-3 border-b border-line py-3 last:border-b-0">
        <div class="size-2.5 animate-pulse rounded-full bg-muted" />
        <div class="flex-1 space-y-2"><div class="h-3 w-1/4 animate-pulse bg-muted" /><div class="h-2.5 w-1/2 animate-pulse bg-muted" /></div>
      </div>
    </div>

    <section v-else class="v2-admin-panel mt-4">
      <div class="v2-admin-panel-head"><span>{{ t("admin.navPage.listTitle") }}</span><span class="text-[10.5px] font-normal text-muted-foreground">{{ t("admin.navPage.itemCount", { count: navRows.length }) }}</span></div>
      <div v-if="!items.length" class="p-6 text-center text-[11.5px] text-muted-foreground">{{ t("admin.navPage.empty") }}</div>
      <div v-for="(item, index) in navRows" :key="item.id" class="v2-admin-row" :class="{ 'pl-8': item.depth > 0 }">
        <div class="flex min-w-0 items-center gap-3">
          <span class="grid size-6 flex-none place-items-center rounded-[3px] bg-pine/10 text-[10px] font-semibold text-pine">{{ item.kind === "categories" ? "▾" : item.kind === "dropdown" ? "▾" : "↗" }}</span>
          <div class="min-w-0">
            <p class="flex flex-wrap items-center gap-2 text-[12.5px] font-semibold">
              {{ item.label }}
              <span class="text-[10px] font-normal text-muted-foreground">{{ item.kind === "categories" ? t("admin.navPage.kindCategories") : item.kind === "dropdown" ? t("admin.navPage.kindDropdown") : item.href }}</span>
              <span v-if="!item.isVisible" class="v2-flag">{{ t("admin.tags.statusHidden") }}</span>
            </p>
            <p v-if="item.kind === 'link'" class="mt-0.5 text-[10.5px] text-muted-foreground">{{ item.openInNewTab ? t("admin.navPage.opensNewTab") : t("admin.navPage.opensHere") }}</p>
          </div>
        </div>
        <div class="flex flex-none items-center gap-1">
          <button type="button" class="v2-btn sm" :disabled="index === 0 || busy === 'reorder'" :aria-label="t('admin.common.moveUp')" @click="move(item, -1)"><ArrowUp :size="13" /></button>
          <button type="button" class="v2-btn sm" :disabled="index === items.length - 1 || busy === 'reorder'" :aria-label="t('admin.common.moveDown')" @click="move(item, 1)"><ArrowDown :size="13" /></button>
          <button type="button" class="v2-btn sm" :disabled="busy === `visible:${item.id}`" :aria-label="item.isVisible ? t('admin.common.hide') : t('admin.common.show')" @click="toggleVisible(item)">
            <Eye v-if="item.isVisible" :size="13" />
            <EyeOff v-else :size="13" />
          </button>
          <button type="button" class="v2-btn sm" :aria-label="t('admin.common.edit')" @click="openEdit(item)"><Pencil :size="13" /></button>
          <button type="button" class="v2-btn sm danger" :disabled="busy === `delete:${item.id}`" :aria-label="t('admin.common.delete')" @click="remove(item)"><Trash2 :size="13" /></button>
        </div>
      </div>
    </section>
  </div>
</template>
