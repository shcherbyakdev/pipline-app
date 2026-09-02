import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Claude Code internals (worktrees from other sessions, SDD scratch) —
    // not project sources; without this, npm run verify walks them.
    ".claude/**",
    ".superpowers/**",
  ]),
  // i18n ratchet (spec 2026-09-02 §6): directories already moved to
  // messages/*.json must not grow new hardcoded JSX text. Each wave appends
  // the directories it migrated. Props are exempt (className would drown the
  // rule); reviews cover placeholder/aria strings.
  {
    files: ["src/app/(auth)/**/*.tsx", "src/features/auth/**/*.tsx", "src/i18n/**/*.tsx"],
    rules: {
      "react/jsx-no-literals": [
        "error",
        { noStrings: true, ignoreProps: true, allowedStrings: [" ", "…", "·", "—", "→"] },
      ],
    },
  },
]);

export default eslintConfig;
