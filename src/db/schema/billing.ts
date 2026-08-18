import { pgTable, uuid, text, integer, boolean, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";

// Cache of the billing provider's truth (spec §7.2). Written ONLY by the
// webhook route (service role); members read their own row; absence = Free.
// CHECKs, RLS, grants live in 0043_billing_security.sql.
export const orgSubscriptions = pgTable(
  "org_subscriptions",
  {
    orgId: uuid("org_id").primaryKey().references(() => orgs.id, { onDelete: "cascade" }),
    plan: text("plan").notNull(),               // 'pro' | 'team'
    status: text("status").notNull(),           // 'active' | 'past_due' | 'cancelled' | 'expired'
    billingInterval: text("billing_interval").notNull(), // 'month' | 'year'
    seats: integer("seats").default(1).notNull(),
    provider: text("provider").notNull(),       // 'stripe' | 'fake'
    providerCustomerId: text("provider_customer_id").notNull(),
    providerSubscriptionId: text("provider_subscription_id").notNull(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false).notNull(),
    // Ordering guard: a webhook older than this is ignored.
    providerUpdatedAt: timestamp("provider_updated_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("org_subscriptions_provider_sub_uq").on(t.providerSubscriptionId)],
);

// Webhook audit + idempotency. Service role only.
export const billingEvents = pgTable(
  "billing_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    orgId: uuid("org_id").references(() => orgs.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    error: text("error"),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("billing_events_provider_event_uq").on(t.provider, t.providerEventId),
    index("billing_events_org_id_idx").on(t.orgId),
  ],
);
