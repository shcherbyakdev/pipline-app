import { pgTable, uuid, text, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";
import { bookings } from "./scheduling";

// S2: one Stripe connected account per org. Status is a cache of the last
// retrieve (features/payments/queries.ts refreshes it); 'active' is the only
// value the create RPCs read.
export const paymentAccounts = pgTable("payment_accounts", {
  orgId: uuid("org_id")
    .primaryKey()
    .references(() => orgs.id, { onDelete: "cascade" }),
  stripeAccountId: text("stripe_account_id").notNull().unique(),
  status: text("status").default("onboarding").notNull(),
  capabilities: jsonb("capabilities").default({}).notNull(),
  checkedAt: timestamp("checked_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// S2: the ledger of provider objects behind a booking's money — one row per
// Checkout session (S3 refunds and S7 charges append here).
export const bookingPayments = pgTable(
  "booking_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    provider: text("provider").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull(),
    status: text("status").notNull(),
    stripeAccountId: text("stripe_account_id"),
    checkoutSessionId: text("checkout_session_id").unique(),
    checkoutUrl: text("checkout_url"),
    checkoutExpiresAt: timestamp("checkout_expires_at", { withTimezone: true }),
    paymentIntentId: text("payment_intent_id"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    refundId: text("refund_id"),
    refundedCents: integer("refunded_cents").default(0).notNull(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("booking_payments_booking_id_idx").on(t.bookingId, t.createdAt)],
);

// S7: after-session charges — overtime, extra heads, cleaning, damage. Own
// table, own RLS (spec ruling 8): the booking's price snapshot stays the
// record of what was agreed; a charge is what happened afterwards.
// booking_balance_cents (0082) sums them.
export const bookingCharges = pgTable(
  "booking_charges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    label: text("label").notNull(),
    qty: integer("qty").default(1).notNull(),
    unitCents: integer("unit_cents").notNull(),
    cents: integer("cents").notNull(),
    note: text("note"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("booking_charges_booking_id_idx").on(t.bookingId)],
);
