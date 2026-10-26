import { defineStore } from "pinia";
import { ref } from "vue";
import { api } from "@/lib/api";

export const useNotificationStore = defineStore("notifications", () => {
  const unread = ref(0);
  const loading = ref(false);

  async function loadUnread(): Promise<void> {
    loading.value = true;
    try {
      const data = await api.notifications({ unread: true, page: 1 });
      unread.value = data.unread;
    } catch {
      unread.value = 0;
    } finally {
      loading.value = false;
    }
  }

  function setUnread(value: number): void {
    unread.value = value;
  }

  function clear(): void {
    unread.value = 0;
  }

  return { unread, loading, loadUnread, setUnread, clear };
});
