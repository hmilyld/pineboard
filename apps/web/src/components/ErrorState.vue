<script setup lang="ts">
defineProps<{ message: string; retry?: boolean }>();
const emit = defineEmits<{ retry: [] }>();
</script>

<template>
  <div class="v2-alert flex items-start gap-3" role="alert">
    <span class="min-w-0 flex-1">{{ message }}</span>
    <button v-if="retry" type="button" class="shrink-0 underline underline-offset-2" @click="emit('retry')">重试</button>
  </div>
</template>
