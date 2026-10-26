<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import { Button } from "@/components/ui/button";
import { api, ApiClientError } from "@/lib/api";
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
const dialog = ref<HTMLElement | null>(null);
let previousFocus: HTMLElement | null = null;

function onKeydown(event: KeyboardEvent): void {
  if (!open.value) return;
  if (event.key === "Escape") {
    event.preventDefault();
    open.value = false;
    return;
  }
  if (event.key !== "Tab") return;
  const list = [...(dialog.value?.querySelectorAll<HTMLElement>('button, [href], select, textarea, input, [tabindex]:not([tabindex="-1"])') ?? [])]
    .filter((el) => !el.hasAttribute("disabled"));
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

watch(open, async (value) => {
  if (value) {
    previousFocus = document.activeElement as HTMLElement | null;
    await nextTick();
    dialog.value?.querySelector<HTMLElement>("[data-report-default]")?.focus();
  } else {
    previousFocus?.focus?.();
    previousFocus = null;
  }
});

onBeforeUnmount(() => previousFocus?.focus?.());

const reasons = [
  ["spam", "垃圾广告"],
  ["abuse", "辱骂/攻击"],
  ["illegal", "违法内容"],
  ["off_topic", "与主题无关"],
  ["other", "其他"],
] as const;

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
    error.value = cause instanceof ApiClientError ? cause.message : "举报失败";
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <template v-if="auth.user && config.config?.feature.reports !== false">
    <button type="button" class="hover:text-foreground" @click="show">举报</button>
    <Teleport to="body">
      <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center overscroll-contain bg-black/40 p-4" @click.self="open = false" @keydown="onKeydown">
        <div ref="dialog" role="dialog" aria-modal="true" aria-labelledby="report-title" class="w-full max-w-md border border-border bg-card p-6 shadow-xl">
          <div class="flex items-center justify-between">
            <h2 id="report-title" class="text-lg font-semibold">举报内容</h2>
            <button type="button" class="text-sm text-muted-foreground hover:text-foreground" data-report-default @click="open = false">关闭</button>
          </div>
          <template v-if="done">
            <p :class="[alertInfoClass, 'mt-4']" role="status">举报已提交，版主会尽快处理。</p>
            <Button class="mt-4 w-full" @click="open = false">完成</Button>
          </template>
          <form v-else class="mt-4 space-y-4" @submit.prevent="submit">
            <div>
              <label :class="labelClass" for="report-reason">原因</label>
              <select id="report-reason" v-model="reason" name="reason" :class="inputClass">
                <option v-for="[value, label] in reasons" :key="value" :value="value">{{ label }}</option>
              </select>
            </div>
            <div>
              <label :class="labelClass" for="report-detail">补充说明（可选）</label>
              <textarea id="report-detail" v-model="detail" name="detail" :class="textareaClass" maxlength="1000" />
            </div>
            <p v-if="error" :class="alertErrorClass" role="alert">{{ error }}</p>
            <Button class="w-full" type="submit" :disabled="submitting">{{ submitting ? "提交中…" : "提交举报" }}</Button>
          </form>
        </div>
      </div>
    </Teleport>
  </template>
</template>
