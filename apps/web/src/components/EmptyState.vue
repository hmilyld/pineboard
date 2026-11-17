<script setup lang="ts">
import { t } from "@/i18n";

defineProps<{ title?: string; message?: string }>();
</script>

<template>
  <div class="v2-empty">
    <p v-if="title" class="text-[0.8125rem] font-semibold text-foreground">{{ title }}</p>
    <p :class="title ? 'mt-1' : ''">{{ message ?? t("empty.default") }}</p>
    <slot />
  </div>
</template>
