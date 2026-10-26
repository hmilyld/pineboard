<script setup lang="ts">
import type { AppConfig } from "@pineboard/shared";
import { onMounted, reactive, ref } from "vue";
import { RouterLink } from "vue-router";
import AdminSkeleton from "@/components/AdminSkeleton.vue";
import { Button } from "@/components/ui/button";
import { ApiClientError, api } from "@/lib/api";
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
  seoDescription: "",
  noindex: false,
  sitemapEnabled: true,
});
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
    error.value = cause instanceof ApiClientError ? cause.message : "加载设置失败";
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
    saved.value = `搜索索引已重建：${result.posts} 条帖子，${result.batches} 个批次。`;
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? cause.message : "重建失败";
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
        announcement: {
          id: current?.site.announcement.id ?? "default",
          enabled: form.announcementEnabled,
          text: form.announcementText,
          href: form.announcementHref,
        },
      },
    }, version.value);
    apply(data.config, data.version);
    saved.value = `已保存，配置版本 ${data.version}。安全相关开关约 5 秒内生效，普通配置约 45 秒。`;
  } catch (cause) {
    error.value = cause instanceof ApiClientError
      ? cause.code === "version_conflict" ? "设置已被他人修改，请刷新后重试。" : cause.message
      : "保存失败";
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
      <div><h1 class="text-[19px] font-bold leading-[1.3]">站点设置</h1><p class="mt-1 text-[10.5px] text-muted-foreground">配置 v{{ version }} · 安全开关约 5 秒生效，普通配置约 45 秒</p></div>
      <RouterLink to="/admin/emails" class="text-[11.5px] text-muted-foreground hover:text-ink">邮件日志</RouterLink>
    </div>

    <p v-if="error" :class="[alertErrorClass, 'mt-6']">{{ error }}</p>
    <p v-if="saved" :class="[alertInfoClass, 'mt-6']">{{ saved }}</p>

    <AdminSkeleton v-if="loading" class="mt-4" />

    <form v-else class="mt-8 space-y-6" @submit.prevent="save">
      <section :class="cardClass">
        <h2 class="text-[12px] font-semibold">站点</h2>
        <div class="mt-3 grid gap-3">
          <div>
            <label :class="labelClass" for="site-name">站点名称</label>
            <input id="site-name" v-model="form.siteName" :class="inputClass" maxlength="200" />
          </div>
          <div>
            <label :class="labelClass" for="site-tagline">一句话介绍</label>
            <input id="site-tagline" v-model="form.tagline" :class="inputClass" maxlength="200" />
          </div>
          <div>
            <label :class="labelClass" for="site-url">站点 URL</label>
            <input id="site-url" v-model="form.siteUrl" :class="inputClass" type="url" />
          </div>
        </div>
      </section>

      <section :class="cardClass">
        <h2 class="text-[12px] font-semibold">注册与写入</h2>
        <div class="mt-4 space-y-3 text-sm">
          <label class="flex items-start gap-3">
            <input v-model="form.registrationOpen" type="checkbox" class="mt-1 size-4 accent-brand" />
            <span>
              <span class="font-medium">开放注册</span>
              <span class="block text-xs text-muted-foreground">关闭后新用户无法创建账户，已有用户仍可登录。</span>
            </span>
          </label>
          <label class="flex items-start gap-3">
            <input v-model="form.requireVerificationForWrite" type="checkbox" class="mt-1 size-4 accent-brand" />
            <span>
              <span class="font-medium">写操作要求邮箱已验证</span>
              <span class="block text-xs text-muted-foreground">未验证用户仍可登录和浏览，但不能发帖、回复或上传。</span>
            </span>
          </label>
          <label class="flex items-start gap-3">
            <input v-model="form.turnstile" type="checkbox" class="mt-1 size-4 accent-brand" />
            <span>
              <span class="font-medium">启用 Turnstile</span>
              <span class="block text-xs text-muted-foreground">注册和写入接口会执行 siteverify；关闭后仅用于本地调试。</span>
            </span>
          </label>
          <label class="flex items-start gap-3">
            <input v-model="form.uploads" type="checkbox" class="mt-1 size-4 accent-brand" />
            <span>
              <span class="font-medium">允许上传图片与压缩附件</span>
              <span class="block text-xs text-muted-foreground">图片仅限 JPG/PNG/WebP/GIF/AVIF；附件仅限 ZIP/RAR/7Z。关闭后编辑器隐藏上传入口。</span>
            </span>
          </label>
        </div>
      </section>

      <section :class="cardClass">
        <h2 class="text-[12px] font-semibold">站点公告</h2>
        <div class="mt-3 space-y-3">
          <label class="flex items-start gap-3 text-[12px]"><input v-model="form.announcementEnabled" type="checkbox" class="mt-1 size-4 accent-brand" /><span><span class="font-medium">显示公告条</span><span class="block text-[10.5px] text-muted-foreground">显示在首页版块条下方，关闭后不占高度。</span></span></label>
          <div><label :class="labelClass" for="announcement-text">公告文案</label><input id="announcement-text" v-model="form.announcementText" :class="inputClass" maxlength="300" placeholder="发帖请带上环境与复现步骤。" /></div>
          <div><label :class="labelClass" for="announcement-href">链接（可选）</label><input id="announcement-href" v-model="form.announcementHref" :class="inputClass" maxlength="300" placeholder="/t/..." /></div>
        </div>
      </section>

      <section :class="cardClass">
        <h2 class="text-[12px] font-semibold">SEO</h2>
        <p class="mt-1 text-[10.5px] leading-5 text-muted-foreground">标题模板支持 <code>{title}</code> 与 <code>{siteName}</code>；首页标题留空时使用站点名称。</p>
        <div class="mt-3 grid gap-3">
          <div><label :class="labelClass" for="seo-title-template">标题模板</label><input id="seo-title-template" v-model="form.titleTemplate" :class="inputClass" maxlength="200" /></div>
          <div><label :class="labelClass" for="seo-home-title">首页标题</label><input id="seo-home-title" v-model="form.homeTitle" :class="inputClass" maxlength="200" placeholder="留空使用站点名称" /></div>
          <div><label :class="labelClass" for="seo-description">首页描述</label><textarea id="seo-description" v-model="form.seoDescription" :class="textareaClass" rows="2" maxlength="500" placeholder="用于首页 meta description 与 JSON-LD" /></div>
          <div class="flex flex-wrap gap-4 text-[12px]">
            <label class="inline-flex items-center gap-2"><input v-model="form.noindex" type="checkbox" class="size-4 accent-brand" />全站 noindex</label>
            <label class="inline-flex items-center gap-2"><input v-model="form.sitemapEnabled" type="checkbox" class="size-4 accent-brand" />启用 sitemap.xml</label>
          </div>
        </div>
      </section>

      <section :class="cardClass">
        <h2 class="text-[12px] font-semibold">分页</h2>
        <p class="mt-1 text-[10.5px] leading-5 text-muted-foreground">主题列表与主题内楼层每页条数；修改后新请求生效。</p>
        <div class="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label :class="labelClass" for="topics-per-page">列表每页主题数</label>
            <input id="topics-per-page" v-model.number="form.topicsPerPage" :class="inputClass" type="number" min="5" max="50" step="1" />
          </div>
          <div>
            <label :class="labelClass" for="posts-per-page">主题内每页楼层数</label>
            <input id="posts-per-page" v-model.number="form.postsPerPage" :class="inputClass" type="number" min="5" max="50" step="1" />
          </div>
        </div>
      </section>

      <section :class="cardClass">
        <h2 class="text-[12px] font-semibold">维护模式</h2>
        <div class="mt-4 space-y-4">
          <label class="flex items-start gap-3 text-sm">
            <input v-model="form.maintenanceEnabled" type="checkbox" class="mt-1 size-4 accent-brand" />
            <span>
              <span class="font-medium">启用维护模式</span>
              <span class="block text-xs text-muted-foreground">启用后非管理员 API 请求会被拦截，站点与认证接口除外。</span>
            </span>
          </label>
          <div>
            <label :class="labelClass" for="maintenance-message">提示文案</label>
            <textarea id="maintenance-message" v-model="form.maintenanceMessage" :class="textareaClass" maxlength="500" />
          </div>
        </div>
      </section>

      <div class="flex items-center gap-3">
        <Button type="submit" :disabled="saving">{{ saving ? "保存中…" : "保存设置" }}</Button>
        <Button type="button" variant="ghost" :disabled="saving" @click="load">重新加载</Button>
        <Button type="button" variant="outline" :disabled="reindexing" @click="reindex">{{ reindexing ? "重建中…" : "重建搜索索引" }}</Button>
      </div>
    </form>
  </div>
</template>
