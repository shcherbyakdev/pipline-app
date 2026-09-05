import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, boolean, integer, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";
import { staff, bookings } from "./scheduling";

// Google Calendar (spec 2026-09-05). Both tables are service_role-only —
// no RLS policy, no grant to authenticated (0076): a refresh token IS the
// account, and the page reads the columns it renders through requireOrg()
// + the admin client. The trigger that feeds booking_calendar_events and
// the grants live in 0076.

// One connected Google account per org (unique per account email; a
// reconnect lands on the same row). staff_id null = shared: its Busy
// events block everyone and bookings with no person (spaces) go here.
export const calendarConnections = pgTable(
  "calendar_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    staffId: uuid("staff_id").references(() => staff.id, { onDelete: "set null" }),
    // Who connected it. References auth.users(id) (managed outside Drizzle).
    userId: uuid("user_id").notNull(),
    provider: text("provider").default("google").notNull(),
    accountEmail: text("account_email").notNull(),
    // AES-256-GCM sealed with GCAL_TOKEN_KEY (lib/google/crypto.ts).
    refreshTokenEnc: text("refresh_token_enc").notNull(),
    accessTokenEnc: text("access_token_enc"),
    accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }),
    // Where confirmed bookings go; null = don't add.
    pushCalendarId: text("push_calendar_id"),
    // Whose Busy events block time.
    busyCalendarIds: text("busy_calendar_ids").array().default([]).notNull(),
    // [{ id, summary, primary, canWrite }] cached at connect time.
    calendars: jsonb("calendars").default([]).notNull(),
    // 'active' | 'needs_reconnect' (CHECK in 0076).
    status: text("status").default("active").notNull(),
    // v2 (0077, Calendly parity): the client is a guest on the event.
    inviteClients: boolean("invite_clients").default(true).notNull(),
    // v2 opt-ins: a Google delete/decline cancels; a Google move reschedules.
    cancelOnDelete: boolean("cancel_on_delete").default(false).notNull(),
    rescheduleOnMove: boolean("reschedule_on_move").default(false).notNull(),
    // events.watch channel on the destination calendar (null = polling only).
    watchChannelId: text("watch_channel_id"),
    watchResourceId: text("watch_resource_id"),
    watchExpiresAt: timestamp("watch_expires_at", { withTimezone: true }),
    // updatedMin cursor for the inbound poll.
    inboundCheckedAt: timestamp("inbound_checked_at", { withTimezone: true }),
    // Last refused inbound edit, shown on the row until the next clean poll.
    inboundNotice: text("inbound_notice"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("calendar_connections_org_id_idx").on(t.orgId),
    index("calendar_connections_staff_id_idx").on(t.staffId),
    uniqueIndex("calendar_connections_org_account_uq").on(t.orgId, t.accountEmail),
  ],
);

// What exists in Google for a booking, and whether it still needs work.
// Upserted pending=true by the bookings trigger; the sync closes the gap
// and either clears pending or deletes the row when nothing should exist.
export const bookingCalendarEvents = pgTable(
  "booking_calendar_events",
  {
    bookingId: uuid("booking_id")
      .primaryKey()
      .references(() => bookings.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id").references(() => calendarConnections.id, { onDelete: "set null" }),
    calendarId: text("calendar_id"),
    eventId: text("event_id"),
    pending: boolean("pending").default(true).notNull(),
    attempts: integer("attempts").default(0).notNull(),
    lastError: text("last_error"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("booking_calendar_events_org_pending_idx").on(t.orgId, t.updatedAt).where(sql`pending`),
    index("booking_calendar_events_connection_id_idx").on(t.connectionId),
  ],
);
