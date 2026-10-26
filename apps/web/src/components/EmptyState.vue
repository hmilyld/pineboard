<script setup lang="ts">
defineProps<{ title?: string; message?: string }>();
</script>

<template>
  <div class="v2-empty">
    <p v-if="title" class="text-[13px] font-semibold text-foreground">{{ title }}</p>
    <p :class="title ? 'mt-1' : ''">{{ message ?? "这里还没有内容。" }}</p>
    <slot />
  </div>
</template>
