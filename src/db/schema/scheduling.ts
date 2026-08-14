import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  date,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { orgs } from "./orgs";
import { clients } from "./clients";

// Scheduling pivot (S1). CHECKs, RLS, grants, the EXCLUDE double-book guard,
// triggers, and RPCs all live in 0026 (custom SQL keeps the security surface
// in one reviewable place — the 0013 idiom).

export const services = pgTable(
  "services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    durationMin: integer("duration_min").notNull(),
    // Free text ("€80", "80 € / Stunde") — no payments at MVP.
    priceLabel: text("price_label"),
    bufferBeforeMin: integer("buffer_before_min").default(0).notNull(),
    bufferAfterMin: integer("buffer_after_min").default(0).notNull(),
    minNoticeMin: integer("min_notice_min").default(0).notNull(),
    // null = unlimited bookings per day.
    maxPerDay: integer("max_per_day"),
    bookingWindowDays: integer("booking_window_days").default(60).notNull(),
    active: boolean("active").default(true).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("services_org_id_idx").on(t.orgId)],
);

export const availabilityRules = pgTable(
  "availability_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    // 0 = Sunday … 6 = Saturday (JS getUTCDay convention). CHECK in 0026.
    weekday: integer("weekday").notNull(),
    // Org-local wall-clock "HH:MM". Format CHECK in 0026. The slot engine
    // converts to UTC per concrete date (DST-safe) — a `time` column would
    // not carry more meaning and complicates the pure-function inputs.
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("availability_rules_org_id_idx").on(t.orgId)],
);

export const availabilityExceptions = pgTable(
  "availability_exceptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    // Org-local calendar date the exception applies to.
    date: date("date").notNull(),
    // closed=true ⇒ whole day off (start/end null). closed=false ⇒ this
    // window REPLACES the weekday rules for that date. CHECK in 0026.
    closed: boolean("closed").default(true).notNull(),
    startTime: text("start_time"),
    endTime: text("end_time"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("availability_exceptions_org_date_idx").on(t.orgId, t.date)],
);

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "restrict" }),
    // set null: a booking is a historical record that survives client
    // deletion — the denormalized name/email below keep it self-contained.
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    clientName: text("client_name").notNull(),
    // nullable since admin walk-ins (calendar slice)
    clientEmail: text("client_email"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    // 'confirmed' | 'cancelled_by_client' | 'cancelled_by_provider' |
    // 'rescheduled' — CHECK in 0026. The EXCLUDE guard covers 'confirmed' only.
    status: text("status").default("confirmed").notNull(),
    // sha256 hex of the manage token (mint.ts idiom). The raw token is
    // returned once from create_booking's caller and never stored.
    cancelTokenHash: text("cancel_token_hash").notNull(),
    note: text("note"),
    // Self-FK deferred to 0026 (drizzle self-reference needs AnyPgColumn
    // gymnastics; the deferred-FK idiom from access_tokens.chase_id is
    // simpler and established).
    rescheduledFromId: uuid("rescheduled_from_id"),
    // Reminder drain state (chasing idiom, S2). reminder_sent_at doubles as
    // the claim marker: set-before-send, rolled back on transport failure.
    // Suppressed reminders (booked <24h ahead) are stamped too — the drain
    // scan (partial index in 0028) only ever sees NULLs.
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    reminderAttempts: integer("reminder_attempts").default(0).notNull(),
    reminderLastError: text("reminder_last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("bookings_org_id_idx").on(t.orgId),
    index("bookings_org_starts_at_idx").on(t.orgId, t.startsAt),
    index("bookings_service_id_idx").on(t.serviceId),
    index("bookings_client_id_idx").on(t.clientId),
    uniqueIndex("bookings_cancel_token_hash_uq").on(t.cancelTokenHash),
  ],
);
