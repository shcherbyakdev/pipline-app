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
    files: [
      "src/app/(auth)/**/*.tsx",
      "src/features/auth/**/*.tsx",
      "src/i18n/**/*.tsx",
      // Wave 1 — the public booking surface (hosted pages, embed, manage
      // page, widget, slot layouts, spaces flows). The studio preview's
      // ghost labels in render/sections/** stay English until Wave 4, so
      // that directory is not ratcheted yet.
      "src/app/[handle]/**/*.tsx",
      "src/app/embed/[handle]/**/*.tsx",
      "src/app/booking/**/*.tsx",
      "src/components/powered-by.tsx",
      "src/features/scheduling/components/slot-layouts/**/*.tsx",
      "src/features/scheduling/components/booking-widget.tsx",
      "src/features/scheduling/components/booking-confirmed.tsx",
      "src/features/scheduling/components/client-details-fields.tsx",
      "src/features/scheduling/components/manage-booking.tsx",
      "src/features/scheduling/components/staff-switch.tsx",
      "src/features/scheduling/components/time-slot-grid.tsx",
      "src/features/rentals/components/rental-booking-flow.tsx",
      "src/features/rentals/components/hourly-booking-flow.tsx",
      "src/features/rentals/components/rental-reschedule-panel.tsx",
      "src/features/rentals/components/hourly-reschedule-panel.tsx",
      "src/features/rentals/components/range-picker.tsx",
      "src/features/rentals/components/stay-fields.tsx",
      "src/features/rentals/components/next-free-stays.tsx",
      "src/features/rentals/components/booking-money-summary.tsx",
      "src/features/rentals/components/unit-select.tsx",
    ],
    rules: {
      "react/jsx-no-literals": [
        "error",
        { noStrings: true, ignoreProps: true, allowedStrings: [" ", "…", "·", "—", "→", "←", "–"] },
      ],
    },
  },
]);

export default eslintConfig;
