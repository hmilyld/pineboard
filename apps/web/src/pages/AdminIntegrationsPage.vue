<script setup lang="ts">
import type { AdminIntegrations, IntegrationSecretName } from "@pineboard/shared";
import { confirmDialog } from "@/lib/confirm";
import { CheckCircle2, KeyRound, Loader2, ShieldCheck, Trash2 } from "lucide-vue-next";
import { computed, onMounted, reactive, ref } from "vue";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { alertErrorClass, alertInfoClass, inputClass, labelClass } from "@/lib/ui";
import { useConfigStore } from "@/stores/config";

const config = useConfigStore();
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

const secretFields = computed<Array<{ key: IntegrationSecretName; label: string; hint: string }>>(() => [
  { key: "resendApiKey", label: "Resend API Key", hint: t("admin.integrations.hintResendKey") },
  { key: "resendWebhookSecret", label: "Resend Webhook Secret", hint: t("admin.integrations.hintResendWebhook") },
  { key: "turnstileSecret", label: "Turnstile Secret Key", hint: t("admin.integrations.hintTurnstile") },
  { key: "r2AccessKeyId", label: "R2 Access Key ID", hint: t("admin.integrations.hintR2KeyId") },
  { key: "r2SecretAccessKey", label: "R2 Secret Access Key", hint: t("admin.integrations.hintR2Secret") },
]);

function statusLabel(source: "database" | "environment" | "missing"): string {
  return source === "database"
    ? t("admin.integrations.sourceDatabase")
    : source === "environment"
      ? t("admin.integrations.sourceEnvironment")
      : t("admin.integrations.sourceMissing");
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
  for (const field of secretFields.value) secrets[field.key] = "";
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
    error.value = config.describeError(cause, "admin.integrations.loadFailed");
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
    for (const field of secretFields.value) {
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
    saved.value = t("admin.integrations.saved");
  } catch (cause) {
    error.value = config.describeError(cause, "common.saveFailed");
  } finally {
    busy.value = "";
  }
}

async function clearSecret(key: IntegrationSecretName, label: string): Promise<void> {
  if (!(await confirmDialog({
    title: t("admin.integrations.clearTitle", { label }),
    message: t("admin.integrations.clearBody"),
    confirmLabel: t("admin.integrations.clear"),
    danger: true,
  }))) return;
  busy.value = `clear:${key}`;
  error.value = "";
  saved.value = "";
  try {
    const snapshot = { ...form };
    const next = await api.updateAdminIntegrations({ secrets: { [key]: null } }, settingsVersion.value);
    apply(next);
    Object.assign(form, snapshot);
    saved.value = t("admin.integrations.cleared", { label });
  } catch (cause) {
    error.value = config.describeError(cause, "admin.integrations.clearFailed");
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
    testResult.value = config.describeError(cause, "admin.integrations.testFailed");
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
        <h1 class="text-[19px] font-bold leading-[1.3]">{{ t("admin.nav.integrations") }}</h1>
        <p class="mt-1 text-[10.5px] text-muted-foreground">{{ t("admin.integrations.subtitle") }}</p>
      </div>
      <span class="flex items-center gap-2 text-[10.5px] text-muted-foreground"><KeyRound :size="13" /> {{ t("admin.integrations.configured", { done: configuredCount, total: secretFields.length }) }}</span>
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
          <span class="flex items-center gap-2"><ShieldCheck :size="14" /> {{ t("admin.integrations.cloudflareTitle") }}</span>
          <button type="button" class="v2-btn sm" :disabled="busy === 'test:cloudflare'" @click="test('cloudflare')">
            <Loader2 v-if="busy === 'test:cloudflare'" :size="12" class="animate-spin" /> {{ t("admin.integrations.checkConfig") }}
          </button>
        </div>
        <div class="grid gap-3 p-4 sm:grid-cols-2">
          <div>
            <label :class="labelClass" for="cf-account">Cloudflare Account ID</label>
            <input id="cf-account" v-model="form.accountId" :class="inputClass" :placeholder="data?.effective.cloudflare.accountId || t('admin.integrations.accountIdPlaceholder')" />
          </div>
          <div>
            <label :class="labelClass" for="cf-bucket">{{ t("admin.integrations.r2Bucket") }}</label>
            <input id="cf-bucket" v-model="form.r2Bucket" :class="inputClass" :placeholder="data?.effective.cloudflare.r2Bucket || 'forum-assets'" />
          </div>
          <div>
            <label :class="labelClass" for="cf-cdn">{{ t("admin.integrations.cdnUrl") }}</label>
            <input id="cf-cdn" v-model="form.cdnUrl" :class="inputClass" placeholder="https://cdn.example.com" />
            <p class="mt-1 text-[10px] text-muted-foreground">{{ t("admin.integrations.effective", { value: data?.effective.cloudflare.cdnUrl || t("admin.integrations.sourceMissing") }) }}</p>
          </div>
          <div>
            <label :class="labelClass" for="cf-site-key">Turnstile Site Key</label>
            <input id="cf-site-key" v-model="form.turnstileSiteKey" :class="inputClass" placeholder="0x4AAAAAAA..." />
            <p class="mt-1 text-[10px] text-muted-foreground">{{ t("admin.integrations.siteKeyNote", { value: data?.effective.cloudflare.turnstileSiteKey || t("admin.integrations.sourceMissing") }) }}</p>
          </div>
        </div>
      </section>

      <section class="v2-admin-panel">
        <div class="v2-admin-panel-head">
          <span>{{ t("admin.integrations.resendTitle") }}</span>
          <button type="button" class="v2-btn sm" :disabled="busy === 'test:resend'" @click="test('resend')">
            <Loader2 v-if="busy === 'test:resend'" :size="12" class="animate-spin" /> {{ t("admin.integrations.testResend") }}
          </button>
        </div>
        <div class="grid gap-3 p-4 sm:grid-cols-2">
          <div>
            <label :class="labelClass" for="mail-from-name">{{ t("admin.integrations.fromName") }}</label>
            <input id="mail-from-name" v-model="form.fromName" :class="inputClass" maxlength="100" :placeholder="t('admin.integrations.fromNamePlaceholder')" />
          </div>
          <div>
            <label :class="labelClass" for="mail-from-address">{{ t("admin.integrations.fromAddress") }}</label>
            <input id="mail-from-address" v-model="form.fromAddress" :class="inputClass" type="email" placeholder="no-reply@mail.example.com" />
          </div>
          <div class="sm:col-span-2">
            <label :class="labelClass" for="mail-reply-to">{{ t("admin.integrations.replyTo") }}</label>
            <input id="mail-reply-to" v-model="form.replyTo" :class="inputClass" type="email" placeholder="support@pineboard.com" />
          </div>
          <div v-for="field in secretFields.filter((item) => item.key.startsWith('resend'))" :key="field.key" class="sm:col-span-2">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <label :class="labelClass" :for="`secret-${field.key}`">{{ field.label }}</label>
              <span class="mb-1 inline-flex items-center gap-2">
                <span class="rounded-full border px-2 py-0.5 text-[10px]" :class="statusClass(data?.secrets[field.key].source ?? 'missing')">{{ statusLabel(data?.secrets[field.key].source ?? "missing") }}</span>
                <button v-if="data?.secrets[field.key].source === 'database'" type="button" class="text-[10px] text-[var(--orange)] hover:opacity-80" :disabled="busy === `clear:${field.key}`" @click="clearSecret(field.key, field.label)"><Trash2 :size="11" class="inline" /> {{ t("admin.integrations.clear") }}</button>
              </span>
            </div>
            <input :id="`secret-${field.key}`" v-model="secrets[field.key]" :class="inputClass" type="password" autocomplete="new-password" :placeholder="data?.secrets[field.key].configured ? t('admin.integrations.secretKeepPlaceholder') : t('admin.integrations.secretPastePlaceholder')" />
            <p class="mt-1 text-[10px] text-muted-foreground">{{ field.hint }}</p>
          </div>
        </div>
      </section>

      <section class="v2-admin-panel">
        <div class="v2-admin-panel-head">
          <span>{{ t("admin.integrations.turnstileTitle") }}</span>
          <button type="button" class="v2-btn sm" :disabled="busy === 'test:turnstile'" @click="test('turnstile')">
            <Loader2 v-if="busy === 'test:turnstile'" :size="12" class="animate-spin" /> {{ t("admin.integrations.testTurnstile") }}
          </button>
        </div>
        <div class="grid gap-3 p-4">
          <div v-for="field in secretFields.filter((item) => !item.key.startsWith('resend'))" :key="field.key">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <label :class="labelClass" :for="`secret-${field.key}`">{{ field.label }}</label>
              <span class="mb-1 inline-flex items-center gap-2">
                <span class="rounded-full border px-2 py-0.5 text-[10px]" :class="statusClass(data?.secrets[field.key].source ?? 'missing')">{{ statusLabel(data?.secrets[field.key].source ?? "missing") }}</span>
                <button v-if="data?.secrets[field.key].source === 'database'" type="button" class="text-[10px] text-[var(--orange)] hover:opacity-80" :disabled="busy === `clear:${field.key}`" @click="clearSecret(field.key, field.label)"><Trash2 :size="11" class="inline" /> {{ t("admin.integrations.clear") }}</button>
              </span>
            </div>
            <input :id="`secret-${field.key}`" v-model="secrets[field.key]" :class="inputClass" type="password" autocomplete="new-password" :placeholder="data?.secrets[field.key].configured ? t('admin.integrations.secretKeepPlaceholder') : t('admin.integrations.secretPastePlaceholder')" />
            <p class="mt-1 text-[10px] text-muted-foreground">{{ field.hint }}</p>
          </div>
        </div>
      </section>

      <div class="flex flex-wrap items-center gap-3">
        <button type="submit" class="v2-btn solid" :disabled="busy === 'save'">{{ busy === "save" ? t("admin.common.saving") : t("admin.integrations.save") }}</button>
        <button type="button" class="v2-btn" :disabled="busy === 'save'" @click="load">{{ t("admin.integrations.reload") }}</button>
        <span class="text-[10.5px] text-muted-foreground">{{ t("admin.integrations.footer") }}</span>
      </div>
    </form>
  </div>
</template>
