<script setup lang="ts">
import type { AdminIntegrations, IntegrationSecretName } from "@pineboard/shared";
import { confirmDialog } from "@/lib/confirm";
import { CheckCircle2, KeyRound, Loader2, ShieldCheck, Trash2 } from "lucide-vue-next";
import { computed, onMounted, reactive, ref } from "vue";
import { api, ApiClientError } from "@/lib/api";
import { alertErrorClass, alertInfoClass, inputClass, labelClass } from "@/lib/ui";

const data = ref<AdminIntegrations | null>(null);
const settingsVersion = ref("0");
const loading = ref(true);
const busy = ref("");
const error = ref("");
const saved = ref("");
const testResult = ref("");
const testOk = ref(false);

const form = reactive({
  accountId: "",
  r2Bucket: "",
  cdnUrl: "",
  turnstileSiteKey: "",
  fromName: "",
  fromAddress: "",
  replyTo: "",
});

const secrets = reactive<Record<IntegrationSecretName, string>>({
  resendApiKey: "",
  resendWebhookSecret: "",
  turnstileSecret: "",
  r2AccessKeyId: "",
  r2SecretAccessKey: "",
});

const secretFields: Array<{ key: IntegrationSecretName; label: string; hint: string }> = [
  { key: "resendApiKey", label: "Resend API Key", hint: "re_ 开头；用于验证、重置、提及邮件" },
  { key: "resendWebhookSecret", label: "Resend Webhook Secret", hint: "whsec_ 开头；用于退信/投诉回调签名" },
  { key: "turnstileSecret", label: "Turnstile Secret Key", hint: "Cloudflare Turnstile 的 Secret Key" },
  { key: "r2AccessKeyId", label: "R2 Access Key ID", hint: "R2 API Token 的 Access Key ID" },
  { key: "r2SecretAccessKey", label: "R2 Secret Access Key", hint: "R2 API Token 的 Secret Access Key" },
];

function statusLabel(source: "database" | "environment" | "missing"): string {
  return source === "database" ? "数据库" : source === "environment" ? "环境变量" : "未配置";
}

function statusClass(source: "database" | "environment" | "missing"): string {
  if (source === "database") return "border-pine/40 bg-pine/10 text-pine";
  if (source === "environment") return "border-line bg-hover text-muted-foreground";
  return "border-[var(--orange)]/40 bg-[var(--orange)]/10 text-[var(--orange)]";
}

const configuredCount = computed(() => {
  if (!data.value) return 0;
  return Object.values(data.value.secrets).filter((item) => item.configured).length;
});

function apply(next: AdminIntegrations): void {
  data.value = next;
  settingsVersion.value = next.version;
  form.accountId = next.config.cloudflare.accountId;
  form.r2Bucket = next.config.cloudflare.r2Bucket;
  form.cdnUrl = next.config.cloudflare.cdnUrl;
  form.turnstileSiteKey = next.config.cloudflare.turnstileSiteKey;
  for (const field of secretFields) secrets[field.key] = "";
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const [integration, settings] = await Promise.all([api.adminIntegrations(), api.adminSettings()]);
    apply(integration);
    settingsVersion.value = settings.version;
    form.fromName = settings.config.mail.fromName;
    form.fromAddress = settings.config.mail.fromAddress;
    form.replyTo = settings.config.mail.replyTo ?? "";
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? cause.message : "加载集成配置失败";
  } finally {
    loading.value = false;
  }
}

async function save(): Promise<void> {
  busy.value = "save";
  error.value = "";
  saved.value = "";
  try {
    const settings = await api.updateAdminSettings({
      mail: {
        fromName: form.fromName.trim(),
        fromAddress: form.fromAddress.trim(),
        replyTo: form.replyTo.trim() || null,
      },
    }, settingsVersion.value);
    settingsVersion.value = settings.version;
    const secretPatch: Partial<Record<IntegrationSecretName, string | null>> = {};
    for (const field of secretFields) {
      const value = secrets[field.key].trim();
      if (value) secretPatch[field.key] = value;
    }
    const next = await api.updateAdminIntegrations({
      integration: {
        cloudflare: {
          accountId: form.accountId.trim(),
          r2Bucket: form.r2Bucket.trim(),
          cdnUrl: form.cdnUrl.trim(),
          turnstileSiteKey: form.turnstileSiteKey.trim(),
        },
      },
      secrets: secretPatch,
    }, settingsVersion.value);
    apply(next);
    saved.value = "集成配置已保存。密钥写入数据库后优先于 Worker 环境变量，约 30 秒内全站生效。";
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? cause.message : "保存失败";
  } finally {
    busy.value = "";
  }
}

async function clearSecret(key: IntegrationSecretName, label: string): Promise<void> {
  if (!(await confirmDialog({ title: `清除 ${label}`, message: "清除后将回退到 Worker 环境变量（如果存在）。", confirmLabel: "清除", danger: true }))) return;
  busy.value = `clear:${key}`;
  error.value = "";
  saved.value = "";
  try {
    const snapshot = { ...form };
    const next = await api.updateAdminIntegrations({ secrets: { [key]: null } }, settingsVersion.value);
    apply(next);
    Object.assign(form, snapshot);
    saved.value = `${label} 已清除。`;
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? cause.message : "清除失败";
  } finally {
    busy.value = "";
  }
}

async function test(service: "resend" | "turnstile" | "cloudflare"): Promise<void> {
  busy.value = `test:${service}`;
  error.value = "";
  testResult.value = "";
  try {
    const result = await api.testIntegration(service);
    testOk.value = result.ok;
    testResult.value = result.message;
  } catch (cause) {
    testOk.value = false;
    testResult.value = cause instanceof ApiClientError ? cause.message : "测试失败";
  } finally {
    busy.value = "";
  }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
      <div>
        <h1 class="text-[19px] font-bold leading-[1.3]">集成配置</h1>
        <p class="mt-1 text-[10.5px] text-muted-foreground">维护 Cloudflare / R2 / Turnstile / Resend。密钥加密存储，读取时只返回配置状态。</p>
      </div>
      <span class="flex items-center gap-2 text-[10.5px] text-muted-foreground"><KeyRound :size="13" /> 已配置 {{ configuredCount }} / {{ secretFields.length }}</span>
    </div>

    <p v-if="error" :class="[alertErrorClass, 'mt-4']">{{ error }}</p>
    <p v-if="saved" :class="[alertInfoClass, 'mt-4']">{{ saved }}</p>
    <p v-if="testResult" class="mt-4 flex items-center gap-2 border px-3 py-2 text-[11.5px]" :class="testOk ? 'border-pine/40 bg-pine/10 text-pine' : 'border-[var(--orange)]/40 bg-[var(--orange)]/10 text-[var(--orange)]'">
      <CheckCircle2 v-if="testOk" :size="14" />
      <span>{{ testResult }}</span>
    </p>

    <div v-if="loading" class="mt-4 space-y-3">
      <div v-for="i in 3" :key="i" class="v2-admin-panel p-4">
        <div class="h-3 w-28 animate-pulse bg-muted" />
        <div class="mt-4 grid gap-3 sm:grid-cols-2">
          <div class="h-9 animate-pulse bg-muted" /><div class="h-9 animate-pulse bg-muted" />
          <div class="h-9 animate-pulse bg-muted" /><div class="h-9 animate-pulse bg-muted" />
        </div>
      </div>
    </div>

    <form v-else class="mt-4 space-y-4" @submit.prevent="save">
      <section class="v2-admin-panel">
        <div class="v2-admin-panel-head">
          <span class="flex items-center gap-2"><ShieldCheck :size="14" /> Cloudflare 基础配置</span>
          <button type="button" class="v2-btn sm" :disabled="busy === 'test:cloudflare'" @click="test('cloudflare')">
            <Loader2 v-if="busy === 'test:cloudflare'" :size="12" class="animate-spin" /> 检查配置
          </button>
        </div>
        <div class="grid gap-3 p-4 sm:grid-cols-2">
          <div>
            <label :class="labelClass" for="cf-account">Cloudflare Account ID</label>
            <input id="cf-account" v-model="form.accountId" :class="inputClass" :placeholder="data?.effective.cloudflare.accountId || '留空则使用 Worker 环境变量'" />
          </div>
          <div>
            <label :class="labelClass" for="cf-bucket">R2 存储桶</label>
            <input id="cf-bucket" v-model="form.r2Bucket" :class="inputClass" :placeholder="data?.effective.cloudflare.r2Bucket || 'forum-assets'" />
          </div>
          <div>
            <label :class="labelClass" for="cf-cdn">CDN 地址</label>
            <input id="cf-cdn" v-model="form.cdnUrl" :class="inputClass" placeholder="https://cdn.example.com" />
            <p class="mt-1 text-[10px] text-muted-foreground">当前生效：{{ data?.effective.cloudflare.cdnUrl || "未配置" }}</p>
          </div>
          <div>
            <label :class="labelClass" for="cf-site-key">Turnstile Site Key</label>
            <input id="cf-site-key" v-model="form.turnstileSiteKey" :class="inputClass" placeholder="0x4AAAAAAA..." />
            <p class="mt-1 text-[10px] text-muted-foreground">公开 Site Key，会下发到前端。当前生效：{{ data?.effective.cloudflare.turnstileSiteKey || "未配置" }}</p>
          </div>
        </div>
      </section>

      <section class="v2-admin-panel">
        <div class="v2-admin-panel-head">
          <span>Resend 发件与凭据</span>
          <button type="button" class="v2-btn sm" :disabled="busy === 'test:resend'" @click="test('resend')">
            <Loader2 v-if="busy === 'test:resend'" :size="12" class="animate-spin" /> 测试 Resend
          </button>
        </div>
        <div class="grid gap-3 p-4 sm:grid-cols-2">
          <div>
            <label :class="labelClass" for="mail-from-name">发件人名称</label>
            <input id="mail-from-name" v-model="form.fromName" :class="inputClass" maxlength="100" placeholder="工坊" />
          </div>
          <div>
            <label :class="labelClass" for="mail-from-address">发件地址</label>
            <input id="mail-from-address" v-model="form.fromAddress" :class="inputClass" type="email" placeholder="no-reply@mail.example.com" />
          </div>
          <div class="sm:col-span-2">
            <label :class="labelClass" for="mail-reply-to">Reply-To（可选）</label>
            <input id="mail-reply-to" v-model="form.replyTo" :class="inputClass" type="email" placeholder="support@pineboard.com" />
          </div>
          <div v-for="field in secretFields.filter((item) => item.key.startsWith('resend'))" :key="field.key" class="sm:col-span-2">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <label :class="labelClass" :for="`secret-${field.key}`">{{ field.label }}</label>
              <span class="mb-1 inline-flex items-center gap-2">
                <span class="rounded-full border px-2 py-0.5 text-[10px]" :class="statusClass(data?.secrets[field.key].source ?? 'missing')">{{ statusLabel(data?.secrets[field.key].source ?? "missing") }}</span>
                <button v-if="data?.secrets[field.key].source === 'database'" type="button" class="text-[10px] text-[var(--orange)] hover:opacity-80" :disabled="busy === `clear:${field.key}`" @click="clearSecret(field.key, field.label)"><Trash2 :size="11" class="inline" /> 清除</button>
              </span>
            </div>
            <input :id="`secret-${field.key}`" v-model="secrets[field.key]" :class="inputClass" type="password" autocomplete="new-password" :placeholder="data?.secrets[field.key].configured ? '留空保持不变' : '粘贴密钥'" />
            <p class="mt-1 text-[10px] text-muted-foreground">{{ field.hint }}</p>
          </div>
        </div>
      </section>

      <section class="v2-admin-panel">
        <div class="v2-admin-panel-head">
          <span>Turnstile 与 R2 密钥</span>
          <button type="button" class="v2-btn sm" :disabled="busy === 'test:turnstile'" @click="test('turnstile')">
            <Loader2 v-if="busy === 'test:turnstile'" :size="12" class="animate-spin" /> 测试 Turnstile
          </button>
        </div>
        <div class="grid gap-3 p-4">
          <div v-for="field in secretFields.filter((item) => !item.key.startsWith('resend'))" :key="field.key">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <label :class="labelClass" :for="`secret-${field.key}`">{{ field.label }}</label>
              <span class="mb-1 inline-flex items-center gap-2">
                <span class="rounded-full border px-2 py-0.5 text-[10px]" :class="statusClass(data?.secrets[field.key].source ?? 'missing')">{{ statusLabel(data?.secrets[field.key].source ?? "missing") }}</span>
                <button v-if="data?.secrets[field.key].source === 'database'" type="button" class="text-[10px] text-[var(--orange)] hover:opacity-80" :disabled="busy === `clear:${field.key}`" @click="clearSecret(field.key, field.label)"><Trash2 :size="11" class="inline" /> 清除</button>
              </span>
            </div>
            <input :id="`secret-${field.key}`" v-model="secrets[field.key]" :class="inputClass" type="password" autocomplete="new-password" :placeholder="data?.secrets[field.key].configured ? '留空保持不变' : '粘贴密钥'" />
            <p class="mt-1 text-[10px] text-muted-foreground">{{ field.hint }}</p>
          </div>
        </div>
      </section>

      <div class="flex flex-wrap items-center gap-3">
        <button type="submit" class="v2-btn solid" :disabled="busy === 'save'">{{ busy === "save" ? "保存中…" : "保存集成配置" }}</button>
        <button type="button" class="v2-btn" :disabled="busy === 'save'" @click="load">重新加载</button>
        <span class="text-[10.5px] text-muted-foreground">密钥只写入数据库，不会回显；填写留空表示保持原值。</span>
      </div>
    </form>
  </div>
</template>
