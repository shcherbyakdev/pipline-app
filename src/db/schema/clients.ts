import { pgTable, uuid, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { orgs } from "./orgs";

// The customer's customer — scopes the read-only portal. RLS (member CRUD),
// grants, and the org-guard trigger live in 0018 (custom SQL keeps the
// security surface in one reviewable place, the 0013 idiom).
export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("clients_org_id_idx").on(t.orgId),
    // A duplicate "Acme Retail Ltd" is a typo, not a case.
    uniqueIndex("clients_org_lower_name_uq").on(t.orgId, sql`lower(${t.name})`),
  ],
);
