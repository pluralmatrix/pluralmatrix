import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    files: ["**/*.ts"],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.node,
    },
    rules: {
      // Aggressively ignoring existing categories of errors
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      // We use @typescript-eslint/no-unused-vars instead (enabled by default in recommended config)
      "no-unused-vars": "off",
    },
  },
  {
    ignores: ["dist/", "node_modules/", "coverage/", "coverage-ui/", ".nyc_output/", "client/"],
  }
);
