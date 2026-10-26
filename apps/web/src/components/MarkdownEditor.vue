<script setup lang="ts">
import {
  UPLOAD_ARCHIVE_EXT,
  UPLOAD_ARCHIVE_MIME,
  UPLOAD_IMAGE_EXT,
  UPLOAD_IMAGE_MIME,
  type UploadKind,
  type UploadResult,
} from "@pineboard/shared";
import { ImagePlus, Loader2, Paperclip } from "lucide-vue-next";
import { computed, ref } from "vue";
import MarkdownRenderer from "@/components/MarkdownRenderer.vue";
import { api, ApiClientError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";
import { useConfigStore } from "@/stores/config";

const props = withDefaults(defineProps<{ modelValue: string; placeholder?: string; rows?: number; flat?: boolean; height?: number }>(), {
  placeholder: "编写点什么…",
  rows: 10,
  flat: false,
  height: undefined,
});
const emit = defineEmits<{ "update:modelValue": [string] }>();
const auth = useAuthStore();
const config = useConfigStore();
const tab = ref<"write" | "preview">("write");
const textarea = ref<HTMLTextAreaElement | null>(null);
const imageInput = ref<HTMLInputElement | null>(null);
const archiveInput = ref<HTMLInputElement | null>(null);
const uploading = ref<UploadKind | null>(null);
const uploadError = ref("");

const uploadsEnabled = computed(() => Boolean(config.config?.feature.uploads && auth.user));
const imageMaxMb = computed(() => config.config?.upload?.imageMaxMb ?? 5);
const fileMaxMb = computed(() => config.config?.upload?.fileMaxMb ?? 10);

const IMAGE_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};
const ARCHIVE_BY_EXT: Record<string, string> = {
  zip: "application/zip",
  rar: "application/vnd.rar",
  "7z": "application/x-7z-compressed",
};
const IMAGE_ACCEPT = [...Object.values(UPLOAD_IMAGE_EXT), "jpeg"].map((ext) => `.${ext}`).join(",");
const ARCHIVE_ACCEPT = Object.keys(ARCHIVE_BY_EXT).map((ext) => `.${ext}`).join(",");

function update(event: Event): void {
  emit("update:modelValue", (event.target as HTMLTextAreaElement).value);
}

function applyInsert(snippet: string, selectStart: number, selectEnd: number): void {
  const value = props.modelValue;
  emit("update:modelValue", `${value.slice(0, selectStart)}${snippet}${value.slice(selectEnd)}`);
  requestAnimationFrame(() => {
    const element = textarea.value;
    if (!element) return;
    element.focus();
    const cursor = selectStart + snippet.length;
    element.setSelectionRange(cursor, cursor);
  });
}

function wrap(before: string, after = ""): void {
  const element = textarea.value;
  if (!element) return;
  const start = element.selectionStart;
  const end = element.selectionEnd;
  const selected = props.modelValue.slice(start, end);
  applyInsert(`${before}${selected}${after}`, start, end);
  requestAnimationFrame(() => {
    const current = textarea.value;
    if (!current) return;
    current.setSelectionRange(start + before.length, end + before.length);
  });
}

function insertBlock(text: string): void {
  const element = textarea.value;
  const start = element?.selectionStart ?? props.modelValue.length;
  const end = element?.selectionEnd ?? props.modelValue.length;
  const prefix = start > 0 && !props.modelValue.slice(0, start).endsWith("\n") ? "\n" : "";
  applyInsert(`${prefix}${text}\n`, start, end);
}

function resolveMeta(file: File, kind: UploadKind): { contentType: string; ext: string } | null {
  const raw = file.type.split(";")[0]?.trim().toLowerCase() ?? "";
  const byName = file.name.toLowerCase().split(".").at(-1) ?? "";
  if (kind === "image") {
    const contentType = raw === "image/jpg" ? "image/jpeg" : raw;
    if ((UPLOAD_IMAGE_MIME as readonly string[]).includes(contentType)) {
      return { contentType, ext: UPLOAD_IMAGE_EXT[contentType] ?? byName };
    }
    const fallback = IMAGE_BY_EXT[byName];
    return fallback ? { contentType: fallback, ext: UPLOAD_IMAGE_EXT[fallback] ?? byName } : null;
  }
  if ((UPLOAD_ARCHIVE_MIME as readonly string[]).includes(raw)) {
    return { contentType: raw, ext: UPLOAD_ARCHIVE_EXT[raw] ?? byName };
  }
  const fallback = ARCHIVE_BY_EXT[byName];
  return fallback ? { contentType: fallback, ext: byName } : null;
}

function markdownName(name: string): string {
  return name.replace(/[\r\n]/g, " ").replace(/[[\]]/g, "\\$&");
}

function insertResult(result: UploadResult, file: File, kind: UploadKind): void {
  const label = markdownName(file.name);
  if (kind === "image") insertBlock(`![${label}](${result.url})`);
  else insertBlock(`[${label}](${result.url})`);
}

async function upload(file: File, kind: UploadKind): Promise<void> {
  uploadError.value = "";
  if (!file.size) {
    uploadError.value = "文件为空";
    return;
  }
  const maxMb = kind === "image" ? imageMaxMb.value : fileMaxMb.value;
  if (file.size > maxMb * 1024 * 1024) {
    uploadError.value = `文件不能超过 ${maxMb}MB`;
    return;
  }
  const meta = resolveMeta(file, kind);
  if (!meta) {
    uploadError.value = kind === "image" ? "仅支持 JPG/PNG/WebP/GIF/AVIF 图片" : "附件仅支持 ZIP/RAR/7Z 压缩包";
    return;
  }
  uploading.value = kind;
  try {
    let signed: Awaited<ReturnType<typeof api.signUpload>>;
    try {
      signed = await api.signUpload({
        kind,
        filename: file.name,
        contentType: meta.contentType,
        size: file.size,
      });
    } catch (cause) {
      // Missing S3 credentials or an offline sign endpoint may use the Worker path;
      // validation/rate-limit/permission errors must surface to the user.
      if (cause instanceof TypeError || (cause instanceof ApiClientError && cause.code === "internal_error")) {
        const result = await api.directUpload(file, kind, meta.contentType);
        insertResult(result, file, kind);
        return;
      }
      throw cause;
    }

    let response: Response;
    try {
      response = await fetch(signed.uploadUrl, {
        method: "PUT",
        headers: { "content-type": signed.contentType },
        body: file,
      });
    } catch {
      // Browser CORS/network failures are the only PUT errors that use the fallback.
      const result = await api.directUpload(file, kind, meta.contentType);
      insertResult(result, file, kind);
      return;
    }
    if (!response.ok) throw new ApiClientError("upload_failed", `上传失败（HTTP ${response.status}）`, response.status);
    const result = await api.completeUpload({ key: signed.key, kind, size: file.size, contentType: signed.contentType });
    insertResult(result, file, kind);
  } catch (cause) {
    uploadError.value = cause instanceof ApiClientError ? cause.message : "上传失败，请稍后重试";
  } finally {
    uploading.value = null;
  }
}

function onPick(kind: UploadKind, event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (file) void upload(file, kind);
}
</script>

<template>
  <div :class="flat ? '' : 'overflow-hidden rounded-[6px] border border-line bg-surface'">
    <div class="flex min-h-8 items-center gap-2 border-b border-line px-3 text-[11.5px]">
      <button type="button" class="v2-tab" :data-active="tab === 'write'" @click="tab = 'write'">编写</button>
      <button type="button" class="v2-tab" :data-active="tab === 'preview'" @click="tab = 'preview'">预览</button>
      <span class="mx-1 h-3 w-px bg-line" />
      <div v-if="tab === 'write'" class="flex items-center gap-0.5 text-muted-foreground">
        <button type="button" class="grid size-[22px] place-items-center rounded-[2px] font-semibold hover:bg-hover hover:text-ink" aria-label="粗体" title="粗体" @click="wrap('**', '**')">B</button>
        <button type="button" class="grid size-[22px] place-items-center rounded-[2px] italic hover:bg-hover hover:text-ink" aria-label="斜体" title="斜体" @click="wrap('_', '_')">I</button>
        <button type="button" class="grid size-[22px] place-items-center rounded-[2px] hover:bg-hover hover:text-ink" aria-label="引用" title="引用（blockquote）" @click="wrap('> ')">›</button>
        <button type="button" class="grid size-[22px] place-items-center rounded-[2px] hover:bg-hover hover:text-ink" aria-label="代码" title="行内代码" @click="wrap('`', '`')">`</button>
        <button type="button" class="grid size-[22px] place-items-center rounded-[2px] hover:bg-hover hover:text-ink" aria-label="链接" title="插入链接" @click="wrap('[', '](https://)')">↗</button>
        <template v-if="uploadsEnabled">
          <span class="mx-1 h-3 w-px bg-line" />
          <button type="button" class="grid size-[22px] place-items-center rounded-[2px] hover:bg-hover hover:text-ink" :disabled="uploading !== null" aria-label="上传图片" title="上传图片（JPG/PNG/WebP/GIF/AVIF）" @click="imageInput?.click()">
            <Loader2 v-if="uploading === 'image'" :size="13" class="animate-spin" />
            <ImagePlus v-else :size="13" />
          </button>
          <button type="button" class="grid size-[22px] place-items-center rounded-[2px] hover:bg-hover hover:text-ink" :disabled="uploading !== null" aria-label="上传压缩附件" title="上传附件（ZIP/RAR/7Z）" @click="archiveInput?.click()">
            <Loader2 v-if="uploading === 'attachment'" :size="13" class="animate-spin" />
            <Paperclip v-else :size="13" />
          </button>
        </template>
      </div>
      <span class="ml-auto text-[10.5px] text-muted-foreground">Markdown</span>
    </div>

    <textarea
      v-if="tab === 'write'"
      ref="textarea"
      :value="modelValue"
      :rows="rows"
      :placeholder="placeholder"
      class="block w-full resize-y border-0 bg-transparent px-3 py-2.5 text-[13.5px] leading-[1.85] text-ink outline-none placeholder:text-muted-foreground/70"
      :style="{ minHeight: height ? `${height}px` : `${Math.max(4, rows) * 1.75}rem` }"
      @input="update"
    />
    <div v-else class="min-h-28 px-4 py-3">
      <MarkdownRenderer v-if="modelValue.trim()" :source="modelValue" />
      <p v-else class="text-[12px] text-muted-foreground">预览为空</p>
    </div>

    <input ref="imageInput" type="file" class="hidden" :accept="IMAGE_ACCEPT" @change="onPick('image', $event)" />
    <input ref="archiveInput" type="file" class="hidden" :accept="ARCHIVE_ACCEPT" @change="onPick('attachment', $event)" />

    <div class="flex items-center border-t border-line px-3 py-1.5 text-[10.5px] text-muted-foreground">
      <span>{{ modelValue.length }} 字符 · 支持 Markdown</span>
      <span v-if="uploadError" class="ml-3 text-[var(--orange)]">{{ uploadError }}</span>
    </div>
  </div>
</template>
