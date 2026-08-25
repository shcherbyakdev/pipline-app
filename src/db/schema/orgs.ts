import { pgTable, uuid, text, timestamp, index, jsonb, boolean } from "drizzle-orm/pg-core";

// Tenant root. Every domain row carries `org_id` and is guarded by an RLS
// policy keyed on the caller's org membership (read from a JWT claim).
export const orgs = pgTable("orgs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  // Portal/participant-surface branding. Written ONLY via the
  // update_org_branding definer RPC (orgs stays select-only for
  // authenticated — 0004). Hex CHECK lives in 0018.
  accentColor: text("accent_color"),
  logoPath: text("logo_path"),
  // Public booking URL segment (/book/[handle]). Nullable — the booking
  // page 404s until the provider picks one on the Booking page screen. Written ONLY via
  // the update_org_scheduling definer RPC (orgs stays select-only — 0004).
  // Format CHECK lives in 0026. Distinct from slug (legacy, non-editable).
  handle: text("handle").unique(),
  // IANA zone for availability wall-times. Validated against
  // pg_timezone_names inside update_org_scheduling.
  timezone: text("timezone").default("UTC").notNull(),
  // H3: one settlement currency per org (H4 Stripe constraint). Whitelist
  // CHECK in 0058; written ONLY via update_org_scheduling.
  currency: text("currency").default("PLN").notNull(),
  // Widget appearance (S3). Written ONLY via update_org_widget_theme
  // (same select-only-orgs discipline as branding). Null = all defaults.
  widgetTheme: jsonb("widget_theme"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  // What the org sells (H1 org modes). Both default true; onboarding sets
  // them explicitly. Written ONLY via create_org / create_org_with_page /
  // update_org_modes definer RPCs (orgs stays select-only — 0004). CHECK
  // "at least one" lives in 0054.
  offersAppointments: boolean("offers_appointments").default(true).notNull(),
  offersRentals: boolean("offers_rentals").default(true).notNull(),
});

export const orgMembers = pgTable(
  "org_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    // References auth.users(id) in Supabase (managed outside Drizzle).
    userId: uuid("user_id").notNull(),
    role: text("role").notNull().default("member"), // owner | admin | member
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Index every column referenced by an RLS policy — top RLS perf rule.
    index("org_members_org_id_idx").on(t.orgId),
    index("org_members_user_id_idx").on(t.userId),
  ],
);

// Handles an org has USED and since renamed away from (0052). A released
// handle is never re-claimable by another org: the old address lives on in
// customers' websites (the embed snippet) and in old confirmation emails, so
// letting a stranger claim it would hand them that traffic. /<old> 308s to
// the org's current handle and /embed/<old> keeps serving the org. Written
// ONLY by update_org_scheduling; read by lib/booking/public.ts via the admin
// client (no API-role grants).
export const orgHandleHistory = pgTable(
  "org_handle_history",
  {
    handle: text("handle").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    releasedAt: timestamp("released_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("org_handle_history_org_id_idx").on(t.orgId)],
);
