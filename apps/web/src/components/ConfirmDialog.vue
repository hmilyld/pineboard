<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import { confirmState, resolveConfirm } from "@/lib/confirm";

const dialog = ref<HTMLElement | null>(null);
let previousFocus: HTMLElement | null = null;

function focusables(): HTMLElement[] {
  return [...(dialog.value?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? [])]
    .filter((el) => !el.hasAttribute("disabled"));
}

function onKeydown(event: KeyboardEvent): void {
  if (!confirmState.open) return;
  if (event.key === "Escape") {
    event.preventDefault();
    resolveConfirm(false);
    return;
  }
  if (event.key !== "Tab") return;
  const list = focusables();
  if (!list.length) return;
  const first = list[0]!;
  const last = list[list.length - 1]!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

watch(
  () => confirmState.open,
  async (open) => {
    if (open) {
      previousFocus = document.activeElement as HTMLElement | null;
      await nextTick();
      dialog.value?.querySelector<HTMLElement>("[data-confirm-default]")?.focus();
      document.addEventListener("keydown", onKeydown);
    } else {
      document.removeEventListener("keydown", onKeydown);
      previousFocus?.focus?.();
      previousFocus = null;
    }
  },
);

onBeforeUnmount(() => document.removeEventListener("keydown", onKeydown));
</script>

<template>
  <Teleport to="body">
    <div v-if="confirmState.open" class="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4" @click.self="resolveConfirm(false)">
      <div ref="dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title" class="w-full max-w-sm border border-border bg-card p-5 shadow-[0_18px_60px_rgba(0,0,0,.28)]">
        <h2 id="confirm-dialog-title" class="text-[15px] font-semibold">{{ confirmState.title }}</h2>
        <p class="mt-2 text-[12px] leading-6 text-muted-foreground">{{ confirmState.message }}</p>
        <div class="mt-5 flex justify-end gap-2">
          <button type="button" class="v2-btn" @click="resolveConfirm(false)">{{ confirmState.cancelLabel }}</button>
          <button type="button" class="v2-btn" :class="confirmState.danger ? 'border-orange bg-orange text-[var(--on-orange)]' : 'solid'" data-confirm-default @click="resolveConfirm(true)">{{ confirmState.confirmLabel }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
