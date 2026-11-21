import tseslint from "typescript-eslint"
import reactHooks from "eslint-plugin-react-hooks"
import nextPlugin from "@next/eslint-plugin-next"

export default tseslint.config(
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      "public/**",
      "coverage/**",
      "**/*.d.ts",
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs}"],
    plugins: { "react-hooks": reactHooks, "@next/next": nextPlugin },
    rules: {
      // The two classic hook rules only. react-hooks v7 also ships the React
      // Compiler rules; adopting those is a separate migration, not a baseline.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      ...nextPlugin.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      // Provider boundaries in this codebase legitimately use `any`; keep it
      // visible without failing the run.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
)
