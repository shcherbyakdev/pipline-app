import { pgTable, uuid, text, timestamp, index, jsonb } from "drizzle-orm/pg-core";

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
  // Widget appearance (S3). Written ONLY via update_org_widget_theme
  // (same select-only-orgs discipline as branding). Null = all defaults.
  widgetTheme: jsonb("widget_theme"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
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
