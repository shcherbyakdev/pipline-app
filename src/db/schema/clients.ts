import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
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
    // Booking-created clients are keyed by email; hand-created ones may
    // lack it. Partial unique (org_id, lower(email)) lives in 0026.
    email: text("email"),
    // 0086: normalised like bookings.client_phone. A booking with no email
    // keys its client by phone instead (partial unique in 0086).
    phone: text("phone"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("clients_org_id_idx").on(t.orgId),
  ],
);
