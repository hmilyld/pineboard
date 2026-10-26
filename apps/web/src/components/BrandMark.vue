<script setup lang="ts">
import { useConfigStore } from "@/stores/config";

withDefaults(defineProps<{ size?: number; showName?: boolean; nameClass?: string }>(), {
  size: 24,
  showName: false,
  nameClass: "",
});
const config = useConfigStore();
</script>

<template>
  <span class="inline-flex min-w-0 items-center gap-2.5">
    <img
      src="/icon.svg"
      alt=""
      aria-hidden="true"
      class="v2-mark v2-mark-icon"
      :style="{ width: `${size}px`, height: `${size}px` }"
      draggable="false"
    />
    <span v-if="showName" class="truncate font-bold" :class="nameClass">{{ config.siteName }}</span>
  </span>
</template>
