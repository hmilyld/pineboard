<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { confirmState, resolveConfirm } from "@/lib/confirm";

// Native <dialog> + showModal(): the browser traps focus, makes the page
// behind the dialog inert (keyboard, pointer, and screen reader alike), and
// closes on Esc — all of which a hand-rolled focus trap cannot do. The
// padding lives on the inner wrapper so a click on the dialog element itself
// can only be a click on the ::backdrop.
const dialog = ref<HTMLDialogElement | null>(null);

watch(
  () => confirmState.open,
  async (open) => {
    await nextTick();
    if (open) dialog.value?.showModal();
    else dialog.value?.close();
  },
);

function onClose(): void {
  // Esc / dismiss paths land here with confirmState still open; an explicit
  // choice resolves the promise first and closes the dialog afterwards.
  if (confirmState.open) resolveConfirm(false);
}

function onClick(event: MouseEvent): void {
  if (event.target === dialog.value) resolveConfirm(false);
}
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      aria-labelledby="confirm-dialog-title"
      class="w-[min(24rem,calc(100%-2rem))] border border-border bg-card shadow-[0_18px_60px_rgba(0,0,0,.28)] backdrop:bg-black/45"
      @close="onClose"
      @click="onClick"
    >
      <div class="p-5">
        <h2 id="confirm-dialog-title" class="text-[15px] font-semibold">{{ confirmState.title }}</h2>
        <p class="mt-2 text-[12px] leading-6 text-muted-foreground">{{ confirmState.message }}</p>
        <div class="mt-5 flex justify-end gap-2">
          <button type="button" class="v2-btn" @click="resolveConfirm(false)">{{ confirmState.cancelLabel }}</button>
          <button type="button" autofocus class="v2-btn" :class="confirmState.danger ? 'border-[var(--orange-cta)] bg-[var(--orange-cta)] text-[var(--on-orange)]' : 'solid'" @click="resolveConfirm(true)">{{ confirmState.confirmLabel }}</button>
        </div>
      </div>
    </dialog>
  </Teleport>
</template>
