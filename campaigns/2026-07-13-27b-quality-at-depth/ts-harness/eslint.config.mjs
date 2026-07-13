// Minimal STRICT flat config for the quality-at-depth grader's lint objective.
// Distilled from ~/work/dippe/AiChatney/.claude/agents/code-logic-writer.md (the verifiable rules only) —
// deliberately NOT AiChatney's full 16k-line multi-plugin config. Type-aware (projectService).
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import stylistic from "@stylistic/eslint-plugin";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { "@stylistic": stylistic },
    rules: {
      // code-logic-writer.md — the machine-checkable subset:
      "@typescript-eslint/no-explicit-any": "error",                 // no implicit/explicit any → unknown + guard
      "@typescript-eslint/explicit-function-return-type": ["error", { allowExpressions: false }], // explicit returns on exported + inline
      "@typescript-eslint/no-non-null-assertion": "error",           // no `!` — guard the empty-default first render
      "max-lines-per-function": ["error", { max: 20, skipBlankLines: true, skipComments: true }], // functions under 20 lines
      "no-magic-numbers": ["warn", { ignore: [0, 1, -1], ignoreArrayIndexes: true, enforceConst: true }], // named constants, not magic values
      "@stylistic/semi": ["error", "always"],
    },
  },
  {
    // tests legitimately use literals and loosely-typed matchers — relax the noisiest rules here,
    // keep the discriminating strict rules on implementation files.
    files: ["**/*.test.ts"],
    rules: {
      "no-magic-numbers": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "max-lines-per-function": "off",
    },
  },
  { ignores: ["node_modules/", "**/*.config.mjs", "cases/_work/hidden.test.ts"] },
);
