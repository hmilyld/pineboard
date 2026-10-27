<script setup lang="ts">
import { RouterLink } from "vue-router";
import { t } from "@/i18n";
</script>

<template>
  <main class="v2-page">
    <div class="v2-container">
      <div class="v2-panel grid overflow-hidden lg:grid-cols-[1fr_1.2fr]">
        <div class="flex min-h-64 flex-col justify-between bg-pine p-8 text-on-pine sm:p-10">
          <p class="text-[11px] text-on-pine/60">{{ t("page.not-found-title") }}</p>
          <p class="text-[7rem] font-bold leading-none tracking-[-0.08em] text-on-pine/90 sm:text-[9rem]">404</p>
        </div>
        <div class="flex flex-col justify-center p-8 sm:p-12">
          <h1 class="text-[28px] font-bold leading-[1.3] tracking-[-0.02em]">{{ t("page.not-found-heading") }}</h1>
          <p class="mt-4 max-w-md text-[12px] leading-7 text-muted-foreground">{{ t("page.not-found-text") }}</p>
          <RouterLink to="/" class="v2-btn solid mt-8 w-fit">{{ t("page.not-found-home") }}</RouterLink>
        </div>
      </div>
    </div>
  </main>
</template>
