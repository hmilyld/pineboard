import { createPinia } from "pinia";
import { createApp } from "vue";
import { registerSW } from "virtual:pwa-register";
import App from "./App.vue";
import { router } from "./router";
import { useConfigStore } from "./stores/config";
import { useUiStore } from "./stores/ui";
import "./styles.css";

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
app.use(router);

const ui = useUiStore(pinia);
ui.setUpdate(
  registerSW({
    immediate: true,
    onNeedRefresh() {
      ui.needRefresh = true;
    },
    onOfflineReady() {
      ui.offlineReady = true;
    },
  }),
);

const config = useConfigStore(pinia);
// Mount after the first `/api/site` so the very first frame already renders in
// the site language; a failed request still mounts with the built-in default.
void config.load().finally(() => {
  app.mount("#app");
});
