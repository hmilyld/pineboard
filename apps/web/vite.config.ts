import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vite";
import pkg from "./package.json";

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  root: new URL(".", import.meta.url).pathname,
  plugins: [
    vue(),
    tailwindcss(),
    cloudflare({
      configPath: new URL("../../wrangler.jsonc", import.meta.url).pathname,
      persistState: {
        path: new URL("../../.wrangler/state", import.meta.url).pathname,
      },
    }),
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      manifest: false,
      workbox: {
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/admin\//, /^\/(sitemap\.xml|robots\.txt|manifest\.webmanifest)$/],
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        runtimeCaching: [
          { urlPattern: ({ url }) => url.pathname.startsWith("/api/"), handler: "NetworkOnly" },
          { urlPattern: ({ url }) => url.pathname.startsWith("/files/"), handler: "NetworkOnly" },
          {
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: { networkTimeoutSeconds: 3, cacheName: "forum-pages" },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
