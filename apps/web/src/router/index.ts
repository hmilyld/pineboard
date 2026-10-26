import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { useConfigStore } from "@/stores/config";
import AdminAuditPage from "@/pages/AdminAuditPage.vue";
import AdminCategoriesPage from "@/pages/AdminCategoriesPage.vue";
import AdminEmailsPage from "@/pages/AdminEmailsPage.vue";
import AdminIntegrationsPage from "@/pages/AdminIntegrationsPage.vue";
import AdminNavPage from "@/pages/AdminNavPage.vue";
import AdminTagsPage from "@/pages/AdminTagsPage.vue";
import AdminUsersPage from "@/pages/AdminUsersPage.vue";
import AdminLayout from "@/components/AdminLayout.vue";
import AdminMaintenancePage from "@/pages/AdminMaintenancePage.vue";
import AdminOverviewPage from "@/pages/AdminOverviewPage.vue";
import ErrorPage from "@/pages/ErrorPage.vue";
import AdminSettingsPage from "@/pages/AdminSettingsPage.vue";
import CategoryPage from "@/pages/CategoryPage.vue";
import EditTopicPage from "@/pages/EditTopicPage.vue";
import HistoryPage from "@/pages/HistoryPage.vue";
import ForgotPasswordPage from "@/pages/ForgotPasswordPage.vue";
import HomePage from "@/pages/HomePage.vue";
import LoginPage from "@/pages/LoginPage.vue";
import MePage from "@/pages/MePage.vue";
import ModReportsPage from "@/pages/ModReportsPage.vue";
import MyCollectionPage from "@/pages/MyCollectionPage.vue";
import NotificationsPage from "@/pages/NotificationsPage.vue";
import PreferencesPage from "@/pages/PreferencesPage.vue";
import NewTopicPage from "@/pages/NewTopicPage.vue";
import NotFoundPage from "@/pages/NotFoundPage.vue";
import RegisterPage from "@/pages/RegisterPage.vue";
import SearchPage from "@/pages/SearchPage.vue";
import SecurityPage from "@/pages/SecurityPage.vue";
import TagPage from "@/pages/TagPage.vue";
import TagsPage from "@/pages/TagsPage.vue";
import ResetPasswordPage from "@/pages/ResetPasswordPage.vue";
import VerifyEmailPage from "@/pages/VerifyEmailPage.vue";
import TopicPage from "@/pages/TopicPage.vue";
import UnsubscribePage from "@/pages/UnsubscribePage.vue";
import UserPage from "@/pages/UserPage.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "home", component: HomePage },
    { path: "/login", name: "login", component: LoginPage, meta: { bare: true } },
    { path: "/register", name: "register", component: RegisterPage, meta: { bare: true } },
    { path: "/forgot-password", name: "forgot-password", component: ForgotPasswordPage, meta: { bare: true } },
    { path: "/reset-password", name: "reset-password", component: ResetPasswordPage, meta: { bare: true } },
    { path: "/verify-email", name: "verify-email", component: VerifyEmailPage, meta: { bare: true } },
    { path: "/c/:slug", name: "category", component: CategoryPage },
    { path: "/t/:id", name: "topic", component: TopicPage },
    { path: "/t/:id/edit", name: "edit-topic", component: EditTopicPage, meta: { requiresAuth: true } },
    { path: "/t/:id/history", name: "topic-history", component: HistoryPage },
    { path: "/new", name: "new-topic", component: NewTopicPage, meta: { requiresAuth: true } },
    { path: "/search", name: "search", component: SearchPage },
    { path: "/tags", name: "tags", component: TagsPage },
    { path: "/tag/:slug", name: "tag", component: TagPage },
    { path: "/u/:username", name: "user", component: UserPage },
    { path: "/me", name: "me", component: MePage, meta: { requiresAuth: true } },
    { path: "/notifications", name: "notifications", component: NotificationsPage, meta: { requiresAuth: true } },
    { path: "/me/preferences", name: "preferences", component: PreferencesPage, meta: { requiresAuth: true } },
    { path: "/me/security", name: "security", component: SecurityPage, meta: { requiresAuth: true } },
    { path: "/unsubscribe", name: "unsubscribe", component: UnsubscribePage, meta: { bare: true } },
    { path: "/me/topics", name: "me-topics", component: MyCollectionPage, meta: { requiresAuth: true } },
    { path: "/me/replies", name: "me-replies", component: MyCollectionPage, meta: { requiresAuth: true } },
    { path: "/me/bookmarks", name: "me-bookmarks", component: MyCollectionPage, meta: { requiresAuth: true } },
    {
      path: "/admin",
      component: AdminLayout,
      meta: { admin: true },
      children: [
        { path: "", name: "admin-overview", component: AdminOverviewPage, meta: { requiresAdmin: true } },
        { path: "reports", name: "mod-reports", component: ModReportsPage, meta: { requiresModerator: true } },
        { path: "categories", name: "admin-categories", component: AdminCategoriesPage, meta: { requiresAdmin: true } },
        { path: "tags", name: "admin-tags", component: AdminTagsPage, meta: { requiresAdmin: true } },
        { path: "users", name: "admin-users", component: AdminUsersPage, meta: { requiresAdmin: true } },
        { path: "nav", name: "admin-nav", component: AdminNavPage, meta: { requiresAdmin: true } },
        { path: "settings", name: "admin-settings", component: AdminSettingsPage, meta: { requiresAdmin: true } },
        { path: "integrations", name: "admin-integrations", component: AdminIntegrationsPage, meta: { requiresAdmin: true } },
        { path: "emails", name: "admin-emails", component: AdminEmailsPage, meta: { requiresAdmin: true } },
        { path: "maintenance", name: "admin-maintenance", component: AdminMaintenancePage, meta: { requiresAdmin: true } },
        { path: "audit", name: "admin-audit", component: AdminAuditPage, meta: { requiresAdmin: true } },
      ],
    },
    { path: "/403", name: "forbidden", component: ErrorPage, props: { code: 403 } },
    { path: "/404", name: "not-found-explicit", component: ErrorPage, props: { code: 404 } },
    { path: "/410", name: "gone", component: ErrorPage, props: { code: 410 } },
    { path: "/500", name: "server-error", component: ErrorPage, props: { code: 500 } },
    { path: "/:pathMatch(.*)*", name: "not-found", component: ErrorPage, props: { code: 404 } },
  ],
  scrollBehavior(to, _from, saved) {
    if (saved) return saved;
    if (to.hash) return { el: to.hash, top: 72, behavior: "smooth" };
    return { top: 0 };
  },
});

router.beforeEach(async (to) => {
  const config = useConfigStore();
  if (!config.config) await config.load();
  const auth = useAuthStore();
  if (!auth.loaded) await auth.refresh();

  if (to.meta.requiresAuth && !auth.user) {
    return { name: "login", query: { next: to.fullPath } };
  }
  if (to.meta.requiresAdmin && !auth.isAdmin) {
    return { name: "forbidden" };
  }
  if (to.meta.requiresModerator && !auth.permissions?.isModerator) {
    return { name: "forbidden" };
  }
  if ((to.name === "login" || to.name === "register") && auth.user) {
    return { name: "me" };
  }
  return true;
});
