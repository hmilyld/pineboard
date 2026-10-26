import { defineStore } from "pinia";
import { ref } from "vue";

type UpdateServiceWorker = (reloadPage?: boolean) => Promise<void>;

export const useUiStore = defineStore("ui", () => {
  const needRefresh = ref(false);
  const offlineReady = ref(false);
  let updateServiceWorker: UpdateServiceWorker | null = null;

  function setUpdate(fn: UpdateServiceWorker): void {
    updateServiceWorker = fn;
  }

  async function applyUpdate(): Promise<void> {
    if (updateServiceWorker) await updateServiceWorker(true);
    needRefresh.value = false;
  }

  function dismiss(): void {
    needRefresh.value = false;
    offlineReady.value = false;
  }

  return { needRefresh, offlineReady, setUpdate, applyUpdate, dismiss };
});
