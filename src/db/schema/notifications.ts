import { pgTable, uuid, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";

// A browser a member enabled Web Push in (spec 2026-09-05). Keyed by the
// USER — the device is theirs — with org_id for listing. RLS (own rows),
// grants and the two preference RPCs live in 0075. The seam
// (features/notifications/push.ts) reads these as service_role and deletes
// a row the push service reports gone (404/410).
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // References auth.users(id) in Supabase (managed outside Drizzle).
    userId: uuid("user_id").notNull(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    // The push service's URL for this browser — the natural key.
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("push_subscriptions_user_id_idx").on(t.userId),
    index("push_subscriptions_org_id_idx").on(t.orgId),
    uniqueIndex("push_subscriptions_endpoint_key").on(t.endpoint),
  ],
);
