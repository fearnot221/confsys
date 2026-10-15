import js from "@eslint/js";
import tseslint from "typescript-eslint";
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      ".tools/**",
      "**/node_modules/**",
      "test-results/**",
      "playwright-report/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,ts,tsx}"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        URL: "readonly",
        fetch: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        AbortSignal: "readonly",
        Buffer: "readonly",
      },
    },
  },
  {
    files: [
      "packages/ui/**/*.{ts,tsx}",
      "apps/web/src/**/components/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            "@confsys/sdk",
            "@confsys/db",
            "@confsys/config",
            "**/hooks/**",
            "node:*",
            "pg",
            "drizzle-orm",
            "@tanstack/*",
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        "fetch",
        "localStorage",
        "sessionStorage",
        "XMLHttpRequest",
        "WebSocket",
        "window",
        "document",
        "globalThis",
        "navigator",
        "eval",
        "Function",
      ],
    },
  },
  {
    files: ["packages/contracts/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: ["@confsys/db", "drizzle-orm", "pg"] },
      ],
    },
  },
);
