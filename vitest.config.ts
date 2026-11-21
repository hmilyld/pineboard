import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
    },
  },
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
      include: ["apps/**/src/**/*.ts", "packages/**/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.d.ts"],
      // Ratchet: raise these as tests land, never lower them.
      thresholds: {
        statements: 9,
        branches: 3,
        functions: 6,
        lines: 9,
      },
    },
  },
});
