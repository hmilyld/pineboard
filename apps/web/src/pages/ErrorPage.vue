<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { t } from "@/i18n";
import { useAuthStore } from "@/stores/auth";

const props = withDefaults(defineProps<{ code?: number }>(), { code: 404 });
const auth = useAuthStore();
function reload(): void { window.location.reload(); }
const copy = computed(() => {
  if (props.code === 403) return { title: t("page.forbidden-title"), text: t("page.forbidden-text") };
  if (props.code === 410) return { title: t("page.gone-title"), text: t("page.gone-text") };
  if (props.code === 500) return { title: t("page.server-title"), text: t("page.server-text") };
  return { title: t("page.not-found-heading"), text: t("page.not-found-text") };
});
</script>

<template>
  <main class="v2-page">
    <div class="v2-container">
    <div class="mx-auto flex min-h-[396px] max-w-[520px] flex-col items-center justify-center py-10 text-center">
      <span class="h-[3px] w-[34px] bg-pine" />
      <p class="num mt-4 text-[56px] font-bold leading-none tracking-[-0.045em]">{{ code }}</p>
      <h1 class="mt-3 text-[18px] font-bold">{{ copy.title }}</h1>
      <p class="mt-2 max-w-[340px] text-[11.5px] leading-[1.85] text-muted-foreground">{{ copy.text }}</p>
      <div class="mt-6 flex gap-2">
        <RouterLink to="/" class="v2-btn solid">{{ t("page.not-found-home") }}</RouterLink>
        <RouterLink v-if="code === 403 && !auth.user" to="/login" class="v2-btn">{{ t("page.login") }}</RouterLink>
        <button v-else-if="code === 500" type="button" class="v2-btn" @click="reload">{{ t("page.refresh") }}</button>
        <RouterLink v-else to="/search" class="v2-btn">{{ t("page.goSearch") }}</RouterLink>
      </div>
      <p class="mt-4 text-[10.5px] text-muted-foreground">{{ t("page.contactProblem") }}<a href="mailto:admin@pineboard.com" class="underline underline-offset-2">{{ t("page.contactAdmin") }}</a></p>
    </div>
    </div>
  </main>
</template>
