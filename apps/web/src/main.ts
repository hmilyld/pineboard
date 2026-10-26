import { createPinia } from "pinia";
import { createApp } from "vue";
import { registerSW } from "virtual:pwa-register";
import App from "./App.vue";
import { router } from "./router";
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

app.mount("#app");
