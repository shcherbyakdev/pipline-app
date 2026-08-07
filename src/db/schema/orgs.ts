import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";

// Tenant root. Every domain row carries `org_id` and is guarded by an RLS
// policy keyed on the caller's org membership (read from a JWT claim).
export const orgs = pgTable("orgs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
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
