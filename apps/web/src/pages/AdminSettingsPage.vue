<script setup lang="ts">
import type { AppConfig, Locale } from "@pineboard/shared";
import { onMounted, reactive, ref } from "vue";
import { RouterLink } from "vue-router";
import AdminSkeleton from "@/components/AdminSkeleton.vue";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { useConfigStore } from "@/stores/config";
import { alertErrorClass, alertInfoClass, cardClass, inputClass, labelClass, linkClass, textareaClass } from "@/lib/ui";

const form = reactive({
  siteName: "",
  tagline: "",
  siteUrl: "",
  registrationOpen: true,
  requireVerificationForWrite: true,
  turnstile: true,
  uploads: true,
  maintenanceEnabled: false,
  maintenanceMessage: "",
  announcementEnabled: false,
  announcementText: "",
  announcementHref: "",
  topicsPerPage: 20,
  postsPerPage: 20,
  titleTemplate: "{title} · {siteName}",
  homeTitle: "",
  siteLanguage: "zh-CN" as Locale,
  seoDescription: "",
  noindex: false,
  sitemapEnabled: true,
});
const config = useConfigStore();
const version = ref("0");
const loading = ref(true);
const saving = ref(false);
const error = ref("");
const saved = ref("");
const reindexing = ref(false);

let current: AppConfig | null = null;

function apply(config: AppConfig, nextVersion: string): void {
  current = config;
  version.value = nextVersion;
  form.siteName = config.site.name;
  form.tagline = config.site.tagline;
  form.siteUrl = config.site.url;
  form.registrationOpen = config.account.registrationOpen;
  form.requireVerificationForWrite = config.account.requireVerificationForWrite;
  form.turnstile = config.feature.turnstile;
  form.uploads = config.feature.uploads;
  form.maintenanceEnabled = config.maintenance.enabled;
  form.maintenanceMessage = config.maintenance.message;
  form.announcementEnabled = config.site.announcement.enabled;
  form.announcementText = config.site.announcement.text;
  form.announcementHref = config.site.announcement.href;
  form.topicsPerPage = config.seo.topicsPerPage;
  form.postsPerPage = config.seo.postsPerPage;
  form.titleTemplate = config.seo.titleTemplate;
  form.homeTitle = config.seo.homeTitle;
  form.siteLanguage = (config.site.language === "en" ? "en" : "zh-CN") as Locale;
  form.seoDescription = config.seo.description;
  form.noindex = config.seo.noindex;
  form.sitemapEnabled = config.seo.sitemapEnabled;
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const data = await api.adminSettings();
    apply(data.config, data.version);
  } catch (cause) {
    error.value = config.describeError(cause, "admin.settings.loadFailed");
  } finally {
    loading.value = false;
  }
}

async function reindex(): Promise<void> {
  reindexing.value = true;
  error.value = "";
  saved.value = "";
  try {
    const result = await api.reindexSearch();
    saved.value = t("admin.settings.reindexDone", { posts: result.posts, batches: result.batches });
  } catch (cause) {
    error.value = config.describeError(cause, "admin.settings.reindexFailed");
  } finally {
    reindexing.value = false;
  }
}

async function save(): Promise<void> {
  saving.value = true;
  error.value = "";
  saved.value = "";
  try {
    const data = await api.updateAdminSettings({
      account: {
        registrationOpen: form.registrationOpen,
        requireVerificationForWrite: form.requireVerificationForWrite,
      },
      feature: { turnstile: form.turnstile, uploads: form.uploads },
      seo: {
        topicsPerPage: Number(form.topicsPerPage),
        postsPerPage: Number(form.postsPerPage),
        titleTemplate: form.titleTemplate,
        homeTitle: form.homeTitle,
        description: form.seoDescription,
        noindex: form.noindex,
        sitemapEnabled: form.sitemapEnabled,
      },
      maintenance: { enabled: form.maintenanceEnabled, message: form.maintenanceMessage },
      site: {
        name: form.siteName,
        tagline: form.tagline,
        url: form.siteUrl,
        language: form.siteLanguage,
        announcement: {
          id: current?.site.announcement.id ?? "default",
          enabled: form.announcementEnabled,
          text: form.announcementText,
          href: form.announcementHref,
        },
      },
    }, version.value);
    apply(data.config, data.version);
    saved.value = t("admin.settings.saved", { version: data.version });
  } catch (cause) {
    error.value = cause && typeof cause === "object" && "code" in cause && String((cause as { code: unknown }).code) === "version_conflict"
      ? t("admin.settings.versionConflict")
      : config.describeError(cause, "common.saveFailed");
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
      <div><h1 class="text-[19px] font-bold leading-[1.3]">{{ t("admin.settings.title") }}</h1><p class="mt-1 text-[10.5px] text-muted-foreground">{{ t("admin.settings.subtitle", { version }) }}</p></div>
      <RouterLink to="/admin/emails" class="text-[11.5px] text-muted-foreground hover:text-ink">{{ t("admin.nav.emails") }}</RouterLink>
    </div>

    <p v-if="error" :class="[alertErrorClass, 'mt-6']">{{ error }}</p>
    <p v-if="saved" :class="[alertInfoClass, 'mt-6']">{{ saved }}</p>

    <AdminSkeleton v-if="loading" class="mt-4" />

    <form v-else class="mt-8 space-y-6" @submit.prevent="save">
      <section :class="cardClass">
        <h2 class="text-[12px] font-semibold">{{ t("admin.settings.siteSection") }}</h2>
        <div class="mt-3 grid gap-3">
          <div>
            <label :class="labelClass" for="site-name">{{ t("admin.settings.siteName") }}</label>
            <input id="site-name" v-model="form.siteName" :class="inputClass" maxlength="200" />
          </div>
          <div>
            <label :class="labelClass" for="site-tagline">{{ t("admin.settings.tagline") }}</label>
            <input id="site-tagline" v-model="form.tagline" :class="inputClass" maxlength="200" />
          </div>
          <div>
            <label :class="labelClass" for="site-url">{{ t("admin.settings.siteUrl") }}</label>
            <input id="site-url" v-model="form.siteUrl" :class="inputClass" type="url" />
          </div>
        </div>
      </section>

      <section :class="cardClass">
        <h2 class="text-[12px] font-semibold">{{ t("admin.settings.languageTitle") }}</h2>
        <p class="mt-1 text-[10.5px] leading-5 text-muted-foreground">{{ t("admin.settings.languageHint") }}</p>
        <div class="mt-3 grid gap-3">
          <div>
            <label :class="labelClass" for="site-language">{{ t("admin.settings.languageLabel") }}</label>
            <select id="site-language" v-model="form.siteLanguage" :class="inputClass">
              <option value="zh-CN">{{ t("admin.settings.languageZh") }}</option>
              <option value="en">{{ t("admin.settings.languageEn") }}</option>
            </select>
            <p class="mt-1 text-[10px] text-muted-foreground">{{ t("admin.settings.languageNote") }}</p>
          </div>
        </div>
      </section>

      <section :class="cardClass">
        <h2 class="text-[12px] font-semibold">{{ t("admin.settings.writeSection") }}</h2>
        <div class="mt-4 space-y-3 text-sm">
          <label class="flex items-start gap-3">
            <input v-model="form.registrationOpen" type="checkbox" class="mt-1 size-4 accent-brand" />
            <span>
              <span class="font-medium">{{ t("admin.settings.registrationOpen") }}</span>
              <span class="block text-xs text-muted-foreground">{{ t("admin.settings.registrationOpenHint") }}</span>
            </span>
          </label>
          <label class="flex items-start gap-3">
            <input v-model="form.requireVerificationForWrite" type="checkbox" class="mt-1 size-4 accent-brand" />
            <span>
              <span class="font-medium">{{ t("admin.settings.requireVerified") }}</span>
              <span class="block text-xs text-muted-foreground">{{ t("admin.settings.requireVerifiedHint") }}</span>
            </span>
          </label>
          <label class="flex items-start gap-3">
            <input v-model="form.turnstile" type="checkbox" class="mt-1 size-4 accent-brand" />
            <span>
              <span class="font-medium">{{ t("admin.settings.turnstile") }}</span>
              <span class="block text-xs text-muted-foreground">{{ t("admin.settings.turnstileHint") }}</span>
            </span>
          </label>
          <label class="flex items-start gap-3">
            <input v-model="form.uploads" type="checkbox" class="mt-1 size-4 accent-brand" />
            <span>
              <span class="font-medium">{{ t("admin.settings.uploads") }}</span>
              <span class="block text-xs text-muted-foreground">{{ t("admin.settings.uploadsHint") }}</span>
            </span>
          </label>
        </div>
      </section>

      <section :class="cardClass">
        <h2 class="text-[12px] font-semibold">{{ t("admin.settings.announcementSection") }}</h2>
        <div class="mt-3 space-y-3">
          <label class="flex items-start gap-3 text-[12px]"><input v-model="form.announcementEnabled" type="checkbox" class="mt-1 size-4 accent-brand" /><span><span class="font-medium">{{ t("admin.settings.announcementEnabled") }}</span><span class="block text-[10.5px] text-muted-foreground">{{ t("admin.settings.announcementEnabledHint") }}</span></span></label>
          <div><label :class="labelClass" for="announcement-text">{{ t("admin.settings.announcementText") }}</label><input id="announcement-text" v-model="form.announcementText" :class="inputClass" maxlength="300" :placeholder="t('admin.settings.announcementPlaceholder')" /></div>
          <div><label :class="labelClass" for="announcement-href">{{ t("admin.settings.announcementHref") }}</label><input id="announcement-href" v-model="form.announcementHref" :class="inputClass" maxlength="300" placeholder="/t/..." /></div>
        </div>
      </section>

      <section :class="cardClass">
        <h2 class="text-[12px] font-semibold">SEO</h2>
        <p class="mt-1 text-[10.5px] leading-5 text-muted-foreground">{{ t("admin.settings.seoHint") }}</p>
        <div class="mt-3 grid gap-3">
          <div><label :class="labelClass" for="seo-title-template">{{ t("admin.settings.titleTemplate") }}</label><input id="seo-title-template" v-model="form.titleTemplate" :class="inputClass" maxlength="200" /></div>
          <div><label :class="labelClass" for="seo-home-title">{{ t("admin.settings.homeTitle") }}</label><input id="seo-home-title" v-model="form.homeTitle" :class="inputClass" maxlength="200" :placeholder="t('admin.settings.homeTitlePlaceholder')" /></div>
          <div><label :class="labelClass" for="seo-description">{{ t("admin.settings.seoDescription") }}</label><textarea id="seo-description" v-model="form.seoDescription" :class="textareaClass" rows="2" maxlength="500" :placeholder="t('admin.settings.seoDescriptionPlaceholder')" /></div>
          <div class="flex flex-wrap gap-4 text-[12px]">
            <label class="inline-flex items-center gap-2"><input v-model="form.noindex" type="checkbox" class="size-4 accent-brand" />{{ t("admin.settings.noindex") }}</label>
            <label class="inline-flex items-center gap-2"><input v-model="form.sitemapEnabled" type="checkbox" class="size-4 accent-brand" />{{ t("admin.settings.sitemap") }}</label>
          </div>
        </div>
      </section>

      <section :class="cardClass">
        <h2 class="text-[12px] font-semibold">{{ t("admin.settings.paginationSection") }}</h2>
        <p class="mt-1 text-[10.5px] leading-5 text-muted-foreground">{{ t("admin.settings.paginationHint") }}</p>
        <div class="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label :class="labelClass" for="topics-per-page">{{ t("admin.settings.topicsPerPage") }}</label>
            <input id="topics-per-page" v-model.number="form.topicsPerPage" :class="inputClass" type="number" min="5" max="50" step="1" />
          </div>
          <div>
            <label :class="labelClass" for="posts-per-page">{{ t("admin.settings.postsPerPage") }}</label>
            <input id="posts-per-page" v-model.number="form.postsPerPage" :class="inputClass" type="number" min="5" max="50" step="1" />
          </div>
        </div>
      </section>

      <section :class="cardClass">
        <h2 class="text-[12px] font-semibold">{{ t("admin.settings.maintenanceSection") }}</h2>
        <div class="mt-4 space-y-4">
          <label class="flex items-start gap-3 text-sm">
            <input v-model="form.maintenanceEnabled" type="checkbox" class="mt-1 size-4 accent-brand" />
            <span>
              <span class="font-medium">{{ t("admin.settings.maintenanceEnabled") }}</span>
              <span class="block text-xs text-muted-foreground">{{ t("admin.settings.maintenanceEnabledHint") }}</span>
            </span>
          </label>
          <div>
            <label :class="labelClass" for="maintenance-message">{{ t("admin.settings.maintenanceMessage") }}</label>
            <textarea id="maintenance-message" v-model="form.maintenanceMessage" :class="textareaClass" maxlength="500" />
          </div>
        </div>
      </section>

      <div class="flex items-center gap-3">
        <Button type="submit" :disabled="saving">{{ saving ? t("admin.common.saving") : t("admin.settings.save") }}</Button>
        <Button type="button" variant="ghost" :disabled="saving" @click="load">{{ t("admin.settings.reload") }}</Button>
        <Button type="button" variant="outline" :disabled="reindexing" @click="reindex">{{ reindexing ? t("admin.settings.reindexing") : t("admin.settings.reindex") }}</Button>
      </div>
    </form>
  </div>
</template>
