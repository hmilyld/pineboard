<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";

interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      theme?: "auto" | "light" | "dark";
      language?: string;
      appearance?: "always" | "execute" | "interaction-only";
      size?: "normal" | "flexible" | "compact";
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ): string;
  reset(widgetId?: string): void;
  remove(widgetId?: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const props = withDefaults(defineProps<{ siteKey: string; action: string; theme?: "auto" | "light" | "dark" }>(), {
  theme: "auto",
});
const emit = defineEmits<{ token: [string]; expired: []; error: [string] }>();

const container = ref<HTMLElement | null>(null);
const needsConfirmation = ref(false);
let widgetId: string | null = null;
let loader: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (loader) return loader;
  loader = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-turnstile="1"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Turnstile 加载失败")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.dataset.turnstile = "1";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Turnstile 加载失败"));
    document.head.appendChild(script);
  });
  return loader;
}

/**
 * Silent by default: `interaction-only` keeps the widget invisible unless
 * Cloudflare needs the visitor to confirm. If the challenge errors, re-render
 * with `appearance: always` so the visitor can finish it manually.
 */
async function render(): Promise<void> {
  if (!props.siteKey) return;
  try {
    await loadScript();
    await nextTick();
    if (!container.value || !window.turnstile) return;
    if (widgetId) {
      window.turnstile.remove(widgetId);
      widgetId = null;
    }
    widgetId = window.turnstile.render(container.value, {
      sitekey: props.siteKey,
      action: props.action,
      theme: props.theme,
      language: "zh-cn",
      appearance: needsConfirmation.value ? "always" : "interaction-only",
      size: needsConfirmation.value ? "normal" : "flexible",
      callback: (token) => emit("token", token),
      "expired-callback": () => {
        emit("token", "");
        emit("expired");
      },
      "error-callback": () => {
        emit("token", "");
        if (!needsConfirmation.value) {
          needsConfirmation.value = true;
          emit("error", "人机验证需要确认，请完成下方验证");
          window.setTimeout(() => void render(), 0);
        }
      },
    });
  } catch (cause) {
    emit("error", cause instanceof Error ? cause.message : "人机验证加载失败");
  }
}

function reset(): void {
  emit("token", "");
  if (widgetId && window.turnstile) window.turnstile.reset(widgetId);
}

/** Called when a submit attempt finds no token: reveal the challenge. */
function show(): void {
  if (needsConfirmation.value) return;
  needsConfirmation.value = true;
  void render();
}

onMounted(render);
onBeforeUnmount(() => {
  if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
  widgetId = null;
});

defineExpose({ reset, show });
</script>

<template>
  <div ref="container" class="v2-turnstile w-full" aria-label="人机验证" />
</template>
