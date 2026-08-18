import { pgTable, uuid, text, boolean, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";

// Owner-only back-office state (spec 2026-08-18-internal-utils §3.3). Both
// tables are written ONLY by the service role from features/utils/actions.ts;
// members may read their own org's rows. CHECKs, RLS, grants live in
// 0045_utils_security.sql.

// A complimentary plan that beats org_subscriptions for entitlements while
// unexpired (lib/billing/queries.ts#getOrgSubscription). Absence = no comp.
export const orgPlanOverrides = pgTable("org_plan_overrides", {
  orgId: uuid("org_id").primaryKey().references(() => orgs.id, { onDelete: "cascade" }),
  plan: text("plan").notNull(),          // 'pro' | 'team'
  expiresAt: timestamp("expires_at", { withTimezone: true }), // null = until revoked
  note: text("note"),
  grantedBy: text("granted_by").notNull(), // internal user's email
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Per-org override of one FLAG_DEFAULTS entry (lib/flags). No row = default.
// The CHECK on `flag` mirrors FLAG_KEYS — adding a flag means a migration
// that widens it.
export const orgFeatureFlags = pgTable(
  "org_feature_flags",
  {
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    flag: text("flag").notNull(),          // 'billing' | 'rentals' | 'overview' | 'command_menu'
    enabled: boolean("enabled").notNull(),
    updatedBy: text("updated_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.flag] })],
);
