<script setup lang="ts">
withDefaults(defineProps<{ rows?: number }>(), { rows: 4 });
</script>

<template>
  <div>
    <div v-for="i in rows" :key="i" class="v2-row" style="--c: var(--line)">
      <div class="space-y-2 py-3">
        <div class="h-3.5 w-2/3 animate-pulse rounded-sm bg-[var(--hover)]" />
        <div class="h-2.5 w-1/3 animate-pulse rounded-sm bg-[var(--hover)]" />
      </div>
      <span /><span /><span />
    </div>
  </div>
</template>
