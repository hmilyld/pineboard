<script setup lang="ts">
import { t } from "@/i18n";

withDefaults(
  defineProps<{
    variant?: "list" | "detail" | "form";
    rows?: number;
    header?: boolean;
    narrow?: boolean;
    side?: boolean;
    bare?: boolean;
  }>(),
  { variant: "list", rows: 6, header: true, narrow: false, side: false, bare: false },
);
</script>

<template>
  <div aria-busy="true" aria-live="polite" :aria-label="t('common.loading')">
    <div :class="[bare ? '' : 'v2-container', narrow ? 'max-w-[780px]' : '', side ? 'v2-main' : '']">
      <div :class="side ? 'min-w-0' : ''">
        <div v-if="header" class="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
          <div class="space-y-2">
            <div class="h-5 w-40 animate-pulse rounded-sm bg-muted" />
            <div class="h-2.5 w-64 max-w-full animate-pulse rounded-sm bg-muted" />
          </div>
          <div class="h-7 w-20 animate-pulse rounded-sm bg-muted" />
        </div>

        <template v-if="variant === 'detail'">
          <div class="mx-auto mt-3 flex max-w-[760px] flex-col gap-3">
            <div class="h-2.5 w-28 animate-pulse rounded-sm bg-muted" />
            <div class="h-7 w-3/4 animate-pulse rounded-sm bg-muted" />
            <div class="h-2.5 w-1/2 animate-pulse rounded-sm bg-muted" />
            <div class="v2-thread mt-2">
              <div v-for="i in 3" :key="i" class="v2-post">
                <div class="v2-rail"><div class="v2-avatar animate-pulse" /><div class="h-2.5 w-12 animate-pulse bg-muted" /><div class="mt-2 h-2 w-10 animate-pulse bg-muted" /></div>
                <div class="v2-post-body space-y-2.5 py-4">
                  <div class="h-3 w-full animate-pulse rounded-sm bg-muted" />
                  <div class="h-3 w-11/12 animate-pulse rounded-sm bg-muted" />
                  <div class="h-3 w-9/12 animate-pulse rounded-sm bg-muted" />
                </div>
              </div>
            </div>
            <div class="mt-2 h-10 animate-pulse rounded-sm bg-muted" />
          </div>
        </template>

        <template v-else-if="variant === 'form'">
          <div class="mt-4 space-y-3">
            <div class="h-[58px] animate-pulse rounded-[6px] bg-muted" />
            <div class="h-64 animate-pulse rounded-[6px] bg-muted/70" />
            <div class="h-10 w-2/3 animate-pulse rounded-sm bg-muted" />
            <div class="flex gap-2"><div class="h-8 w-24 animate-pulse bg-muted" /><div class="h-8 w-20 animate-pulse bg-muted" /></div>
          </div>
        </template>

        <template v-else>
          <div class="v2-panel mt-3">
            <div class="v2-bar"><div class="h-3 w-24 animate-pulse bg-muted" /><div class="ml-auto h-3 w-16 animate-pulse bg-muted" /></div>
            <div v-for="i in rows" :key="i" class="v2-row" style="--c: var(--line)">
              <div class="space-y-2 py-3">
                <div class="h-3.5 w-2/3 animate-pulse rounded-sm bg-[var(--hover)]" />
                <div class="h-2.5 w-1/3 animate-pulse rounded-sm bg-[var(--hover)]" />
              </div>
              <span /><span /><span />
            </div>
          </div>
        </template>
      </div>

      <aside v-if="side" class="v2-side">
        <div class="space-y-3">
          <div class="h-3 w-16 animate-pulse bg-muted" />
          <div class="h-24 animate-pulse bg-muted" />
          <div class="h-3 w-20 animate-pulse bg-muted" />
          <div class="space-y-2">
            <div v-for="i in 4" :key="i" class="h-8 animate-pulse bg-muted" />
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>
