// Flat ESLint config (ESLint 10). Root config applies to all workspaces.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import pluginVue from "eslint-plugin-vue";
import prettier from "eslint-config-prettier";

// Browser globals used by the web app (dependency-free; avoids the `globals` package).
const browserGlobals = {
  window: "readonly",
  document: "readonly",
  navigator: "readonly",
  console: "readonly",
  confirm: "readonly",
  alert: "readonly",
  fetch: "readonly",
  atob: "readonly",
  btoa: "readonly",
  localStorage: "readonly",
  sessionStorage: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  URL: "readonly",
  crypto: "readonly",
  createImageBitmap: "readonly",
  Blob: "readonly",
  File: "readonly",
  Event: "readonly",
  HTMLElement: "readonly",
  HTMLCanvasElement: "readonly",
  HTMLInputElement: "readonly",
};

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "TemplatesTailwind/**",
      "supabase/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs["flat/recommended"],
  {
    files: ["**/*.vue"],
    languageOptions: {
      globals: browserGlobals,
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },
  {
    // Browser globals for the web app's TS modules too (supabase/api/jwt helpers).
    files: ["apps/web/**/*.ts"],
    languageOptions: {
      globals: browserGlobals,
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  prettier,
);
