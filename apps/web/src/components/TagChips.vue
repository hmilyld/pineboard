<script setup lang="ts">
import type { Tag } from "@pineboard/shared";
import { RouterLink } from "vue-router";

withDefaults(defineProps<{ tags: Tag[]; small?: boolean }>(), { small: false });
</script>

<template>
  <span class="inline-flex flex-wrap items-center gap-1.5">
    <RouterLink v-for="tag in tags" :key="tag.id" :to="`/tag/${tag.slug}`" class="v2-tag" :class="small ? '!text-[10px]' : ''">
      <span class="text-pine">#</span>{{ tag.name }}
    </RouterLink>
  </span>
</template>
