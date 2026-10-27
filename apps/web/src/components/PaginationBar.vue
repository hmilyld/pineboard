<script setup lang="ts">
import { computed } from "vue";
import { t } from "@/i18n";

const props = withDefaults(defineProps<{ page: number; totalPages: number; total?: number; compact?: boolean; unit?: string }>(), {
  total: undefined,
  compact: false,
  unit: undefined,
});
const emit = defineEmits<{ change: [number] }>();

const pages = computed<Array<number | "…">>(() => {
  const total = Math.max(1, props.totalPages);
  const current = Math.min(total, Math.max(1, props.page));
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const result: Array<number | "…"> = [1];
  const start = Math.max(2, current - 2);
  const end = Math.min(total - 1, current + 2);
  if (start > 2) result.push("…");
  for (let i = start; i <= end; i++) result.push(i);
  if (end < total - 1) result.push("…");
  result.push(total);
  return result;
});

const unitLabel = computed(() => props.unit ?? t("pager.unitTopics"));

function go(page: number): void {
  if (page < 1 || page > props.totalPages || page === props.page) return;
  emit("change", page);
}
</script>

<template>
  <nav class="v2-pager" :class="compact ? 'justify-center' : 'justify-center py-3'" :aria-label="t('pager.label')">
    <button type="button" :disabled="page <= 1" :aria-label="t('pager.prev')" @click="go(page - 1)">‹</button>
    <template v-for="(item, index) in pages" :key="`${item}-${index}`">
      <span v-if="item === '…'" class="px-1 text-muted-foreground">…</span>
      <button v-else type="button" :aria-current="item === page ? 'page' : undefined" @click="go(item)">{{ item }}</button>
    </template>
    <button type="button" :disabled="page >= totalPages" :aria-label="t('pager.next')" @click="go(page + 1)">›</button>
    <span v-if="total !== undefined" class="ml-3 text-[10.5px] text-muted-foreground">{{ t("pager.total", { total, unit: unitLabel }) }}</span>
  </nav>
</template>
