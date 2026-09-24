// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from "eslint-plugin-storybook";

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config({
  ignores: [
    ".output",
    ".wxt",
    "dist",
    "node_modules",
    "coverage",
    "playwright-report",
    "test-results",
    "storybook-static",
  ],
}, js.configs.recommended, ...tseslint.configs.recommended, {
  files: ["**/*.{ts,tsx,mts,cts}"],
  plugins: { "react-hooks": reactHooks },
  rules: {
    ...reactHooks.configs.recommended.rules,
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-unused-vars": [
      "error",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
    "no-console": ["warn", { allow: ["warn", "error", "debug"] }],
  },
}, {
  files: [
    "tests/**/*.ts",
    "e2e/**/*.ts",
    "**/*.config.{ts,js}",
    "scripts/**/*.mjs",
  ],
  languageOptions: {
    globals: {
      URL: "readonly",
      console: "readonly",
      process: "readonly",
    },
  },
  rules: {
    "no-console": "off",
  },
}, storybook.configs["flat/recommended"]);
