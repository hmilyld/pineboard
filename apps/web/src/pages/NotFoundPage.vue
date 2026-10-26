<script setup lang="ts">
import { RouterLink } from "vue-router";
</script>

<template>
  <main class="v2-page">
    <div class="v2-container">
      <div class="v2-panel grid overflow-hidden lg:grid-cols-[1fr_1.2fr]">
        <div class="flex min-h-64 flex-col justify-between bg-pine p-8 text-on-pine sm:p-10">
          <p class="text-[11px] text-on-pine/60">页面不存在</p>
          <p class="text-[7rem] font-bold leading-none tracking-[-0.08em] text-on-pine/90 sm:text-[9rem]">404</p>
        </div>
        <div class="flex flex-col justify-center p-8 sm:p-12">
          <h1 class="text-[28px] font-bold leading-[1.3] tracking-[-0.02em]">走到了没有路的地方。</h1>
          <p class="mt-4 max-w-md text-[12px] leading-7 text-muted-foreground">链接可能已失效，或者内容被移动了。回到首页，从版块索引重新开始。</p>
          <RouterLink to="/" class="v2-btn solid mt-8 w-fit">返回首页</RouterLink>
        </div>
      </div>
    </div>
  </main>
</template>
