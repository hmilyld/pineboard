<template>
  <div aria-busy="true" aria-label="加载中">
    <div class="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
      <div class="space-y-2">
        <div class="h-5 w-28 animate-pulse bg-muted" />
        <div class="h-2.5 w-64 max-w-full animate-pulse bg-muted" />
      </div>
      <div class="h-7 w-24 animate-pulse bg-muted" />
    </div>
    <div class="v2-admin-grid mt-3">
      <div v-for="i in 4" :key="i" class="v2-admin-card"><div class="h-6 w-12 animate-pulse bg-muted" /><div class="mt-2 h-2.5 w-16 animate-pulse bg-muted" /></div>
    </div>
    <div class="v2-admin-panel mt-4">
      <div class="v2-admin-panel-head"><div class="h-3 w-24 animate-pulse bg-muted" /></div>
      <div v-for="i in 5" :key="i" class="v2-admin-row">
        <div class="space-y-2"><div class="h-3 w-1/2 animate-pulse bg-muted" /><div class="h-2.5 w-2/3 animate-pulse bg-muted" /></div>
        <div class="h-7 w-16 animate-pulse bg-muted" />
      </div>
    </div>
  </div>
</template>
