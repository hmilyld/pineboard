import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import eslintPluginVue from "eslint-plugin-vue";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.wrangler/**",
      "coverage/**",
      "docs/**",
      "spikes/**",
      "apps/web/public/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...eslintPluginVue.configs["flat/recommended"],
  {
    files: ["**/*.ts", "**/*.vue"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.worker,
        __APP_VERSION__: "readonly",
      },
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["**/*.vue"],
    rules: {
      // Template-only bindings in <script setup> are invisible to the TS scope
      // analyzer; vue-tsc (noUnusedLocals) is the source of truth there.
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    files: ["apps/web/src/components/ui/**/*.vue"],
    rules: {
      // shadcn-vue primitives keep their upstream single-word names.
      "vue/multi-word-component-names": "off",
    },
  },
  {
    files: ["scripts/**/*.mjs", "**/*.config.ts", "eslint.config.js"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  eslintConfigPrettier,
);
