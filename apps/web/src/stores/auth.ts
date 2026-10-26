import type { CurrentUser, Me } from "@pineboard/shared";
import { derivePassword } from "@pineboard/shared";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { api } from "@/lib/api";

export const useAuthStore = defineStore("auth", () => {
  const user = ref<CurrentUser | null>(null);
  const permissions = ref<Me["permissions"] | null>(null);
  const loaded = ref(false);
  const loading = ref(false);
  const configVersion = ref("0");

  async function refresh(): Promise<void> {
    loading.value = true;
    try {
      const me = await api.meOptional();
      user.value = me?.user ?? null;
      permissions.value = me?.permissions ?? null;
      configVersion.value = me?.configVersion ?? "0";
    } catch {
      user.value = null;
      permissions.value = null;
    } finally {
      loaded.value = true;
      loading.value = false;
    }
  }

  async function signIn(email: string, password: string): Promise<void> {
    const derived = await derivePassword(email, password);
    await api.signIn(email.trim().toLowerCase(), derived);
    await refresh();
  }

  async function signUp(input: {
    email: string;
    password: string;
    name: string;
    username: string;
    turnstileToken: string;
  }): Promise<void> {
    const derived = await derivePassword(input.email, input.password);
    await api.signUp({
      email: input.email.trim().toLowerCase(),
      password: derived,
      name: input.name.trim(),
      username: input.username.trim().toLowerCase(),
      turnstileToken: input.turnstileToken,
    });
    await refresh();
  }

  async function signOut(): Promise<void> {
    await api.signOut();
    user.value = null;
    permissions.value = null;
  }

  const isAdmin = computed(() => user.value?.role === "admin");
  const isVerified = computed(() => user.value?.emailVerified ?? false);
  const canWrite = computed(() => permissions.value?.canWrite ?? false);
  const displayName = computed(() => user.value?.name || user.value?.username || user.value?.email || "");

  return {
    user,
    permissions,
    loaded,
    loading,
    configVersion,
    refresh,
    signIn,
    signUp,
    signOut,
    isAdmin,
    isVerified,
    canWrite,
    displayName,
  };
});
