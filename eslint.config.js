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
  setInterval: "readonly",
  clearInterval: "readonly",
  URL: "readonly",
  crypto: "readonly",
  createImageBitmap: "readonly",
  Blob: "readonly",
  File: "readonly",
  Event: "readonly",
  HTMLElement: "readonly",
  HTMLCanvasElement: "readonly",
  HTMLInputElement: "readonly",
  FileList: "readonly",
  DragEvent: "readonly",
  DataTransfer: "readonly",
};

export default tseslint.config(
  {
    ignores: [
      "tools/**", // standalone on-prem agent (own Node runtime; not app-linted)
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "TemplatesTailwind/**",
      "supabase/**",
      "data-samples/**",
      "_probes/**",
      "_to_delete/**",
      "**/*.generated.ts", // codegen output — authored by scripts/gen-*.mjs, verified by the drift check
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs["flat/recommended"],
  {
    // typescript-eslint infers the TSConfig root by walking up from each file. `apps/driver` carries its
    // own tsconfig (Expo/RN needs one), so from inside that subtree there are TWO candidate roots — the
    // workspace root and the driver app — and the parser refuses to guess, failing EVERY file in the repo
    // with "No tsconfigRootDir was set". Pinning it to this config's own directory is the documented fix
    // and is correct for a monorepo: the root is where this flat config lives, always.
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
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
    // Browser globals for the web + admin apps' TS modules too (supabase/api/jwt helpers).
    files: ["apps/web/**/*.ts", "apps/admin/**/*.ts"],
    languageOptions: {
      globals: browserGlobals,
    },
  },
  {
    files: ["**/*.mjs", "scripts/**/*.js"],
    languageOptions: {
      globals: { process: "readonly", console: "readonly", URL: "readonly", Buffer: "readonly" },
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Module boundary: consume the shared package through its public barrel, not deep internals.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@fuelguard/shared/*"],
              message: "Import from the @fuelguard/shared barrel (its index), not deep internal paths.",
            },
          ],
        },
      ],
    },
  },
  prettier,
);
