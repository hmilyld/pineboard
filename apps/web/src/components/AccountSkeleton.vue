<script setup lang="ts">
import { t } from "@/i18n";
</script>

<template>
  <div class="v2-account" aria-busy="true" :aria-label="t('common.loading')">
    <aside class="v2-account-nav">
      <div class="v2-account-group">
        <div class="mb-2 h-2.5 w-10 animate-pulse bg-muted" />
        <div v-for="i in 3" :key="i" class="mb-1 h-8 animate-pulse bg-muted" />
      </div>
      <div class="v2-account-group">
        <div class="mb-2 h-2.5 w-12 animate-pulse bg-muted" />
        <div v-for="i in 4" :key="`s-${i}`" class="mb-1 h-8 animate-pulse bg-muted" />
      </div>
    </aside>
    <div class="min-w-0">
      <div class="v2-profile-head">
        <div class="v2-profile-top">
          <div class="v2-profile-avatar animate-pulse" />
          <div class="flex-1 space-y-2">
            <div class="h-5 w-32 animate-pulse bg-muted" />
            <div class="h-2.5 w-48 animate-pulse bg-muted" />
          </div>
        </div>
        <div class="v2-profile-stats">
          <div v-for="i in 4" :key="i" class="v2-profile-stat"><div class="h-4 w-10 animate-pulse bg-muted" /><div class="mt-1 h-2.5 w-10 animate-pulse bg-muted" /></div>
        </div>
      </div>
      <div class="mt-4 h-3 w-24 animate-pulse bg-muted" />
      <div class="v2-panel mt-2">
        <div v-for="i in 5" :key="i" class="v2-row" style="--c: var(--line)">
          <div class="space-y-2 py-3">
            <div class="h-3.5 w-2/3 animate-pulse rounded-sm bg-[var(--hover)]" />
            <div class="h-2.5 w-1/3 animate-pulse rounded-sm bg-[var(--hover)]" />
          </div>
          <span /><span /><span />
        </div>
      </div>
    </div>
  </div>
</template>
