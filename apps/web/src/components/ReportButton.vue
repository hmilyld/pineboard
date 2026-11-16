<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { alertErrorClass, alertInfoClass, inputClass, labelClass, textareaClass } from "@/lib/ui";
import { useAuthStore } from "@/stores/auth";
import { useConfigStore } from "@/stores/config";

const props = defineProps<{ targetType: "topic" | "post"; targetId: string }>();
const auth = useAuthStore();
const config = useConfigStore();
const open = ref(false);
const reason = ref("spam");
const detail = ref("");
const error = ref("");
const done = ref(false);
const submitting = ref(false);
// Native <dialog>: the browser traps focus, renders the page behind it inert,
// closes on Esc, and restores focus on close — no hand-rolled trap needed.
// Padding lives on the inner wrapper so clicks on the dialog element itself
// can only be clicks on the ::backdrop.
const dialog = ref<HTMLDialogElement | null>(null);

watch(open, async (value) => {
  await nextTick();
  if (value) dialog.value?.showModal();
  else dialog.value?.close();
});

function onClose(): void {
  if (open.value) open.value = false;
}

function onClick(event: MouseEvent): void {
  if (event.target === dialog.value && open.value) open.value = false;
}

const REASONS = ["spam", "abuse", "illegal", "off_topic", "other"] as const;
const reasons = computed(() => REASONS.map((value) => [value, t(`report.${value}`)] as const));

function show(): void {
  done.value = false;
  error.value = "";
  open.value = true;
}

async function submit(): Promise<void> {
  submitting.value = true;
  error.value = "";
  try {
    await api.report({ targetType: props.targetType, targetId: props.targetId, reasonCode: reason.value, detail: detail.value });
    done.value = true;
  } catch (cause) {
    error.value = config.describeError(cause, "report.failed");
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <template v-if="auth.user && config.config?.feature.reports !== false">
    <button type="button" class="hover:text-foreground" @click="show">{{ t("report.button") }}</button>
    <Teleport to="body">
      <dialog
        ref="dialog"
        aria-labelledby="report-title"
        class="w-[min(28rem,calc(100%-2rem))] border border-border bg-card shadow-xl backdrop:bg-black/40"
        @close="onClose"
        @click="onClick"
      >
        <div class="p-6">
          <div class="flex items-center justify-between">
            <h2 id="report-title" class="text-lg font-semibold">{{ t("report.title") }}</h2>
            <button type="button" autofocus class="text-sm text-muted-foreground hover:text-foreground" @click="open = false">{{ t("common.close") }}</button>
          </div>
          <template v-if="done">
            <p :class="[alertInfoClass, 'mt-4']" role="status">{{ t("report.done") }}</p>
            <Button class="mt-4 w-full" @click="open = false">{{ t("report.finish") }}</Button>
          </template>
          <form v-else class="mt-4 space-y-4" @submit.prevent="submit">
            <div>
              <label :class="labelClass" for="report-reason">{{ t("report.reason") }}</label>
              <select id="report-reason" v-model="reason" name="reason" :class="inputClass">
                <option v-for="[value, label] in reasons" :key="value" :value="value">{{ label }}</option>
              </select>
            </div>
            <div>
              <label :class="labelClass" for="report-detail">{{ t("report.detail") }}</label>
              <textarea id="report-detail" v-model="detail" name="detail" :class="textareaClass" maxlength="1000" />
            </div>
            <p v-if="error" :class="alertErrorClass" role="alert">{{ error }}</p>
            <Button class="w-full" type="submit" :disabled="submitting">{{ submitting ? t("report.submitting") : t("report.submit") }}</Button>
          </form>
        </div>
      </dialog>
    </Teleport>
  </template>
</template>
