"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { requireOrg } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { CONNECTION_COLUMNS, requeueScope, rowToConnection } from "./connections";
import { runCalendarSync } from "./run";

export type ActionResult = { ok: true } | { ok: false; error: string };

// Every refusal a person reads is the generic line (notifications/actions.ts
// idiom); the cause is logged.
async function invalid(): Promise<ActionResult> {
  const t = await getTranslations("errors");
  return { ok: false, error: t("generic") };
}
async function fail(context: string, error: unknown): Promise<ActionResult> {
  console.error(`[calendar] ${context}:`, error);
  return invalid();
}

/** The connection, if it is this org's. The table has no member grant, so
    the org scope is this check — never the row id alone. */
async function ownConnection(connectionId: string) {
  const { org } = await requireOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("calendar_connections")
    .select(CONNECTION_COLUMNS)
    .eq("id", connectionId)
    .eq("org_id", org.id)
    .maybeSingle();
  if (error) throw error;
  return { org, admin, connection: data ? rowToConnection(data) : null };
}

const calendarsInput = z.object({
  connectionId: z.string().uuid(),
  pushCalendarId: z.string().min(1).nullable(),
  busyCalendarIds: z.array(z.string().min(1)).max(50),
});

/** "Add bookings to" and "Block time from". Both must name calendars the
    account actually has (the cached list), and the destination must be
    writable. A changed destination re-queues the scope's upcoming bookings
    so the mirror moves, and pushes them now. */
export async function setConnectionCalendars(input: unknown): Promise<ActionResult> {
  const parsed = calendarsInput.safeParse(input);
  if (!parsed.success) return invalid();
  const { org, admin, connection } = await ownConnection(parsed.data.connectionId);
  if (!connection) return invalid();
  const known = new Map(connection.calendars.map((c) => [c.id, c]));
  const push = parsed.data.pushCalendarId;
  if (push && !known.get(push)?.canWrite) return invalid();
  const busy = [...new Set(parsed.data.busyCalendarIds)].filter((id) => known.has(id));
  const { error } = await admin
    .from("calendar_connections")
    .update({ push_calendar_id: push, busy_calendar_ids: busy, updated_at: new Date().toISOString() })
    .eq("id", connection.id);
  if (error) return fail("setConnectionCalendars", error);
  if (push !== connection.pushCalendarId) {
    try {
      await requeueScope(org.id, connection.staffId, admin);
      await runCalendarSync({ orgId: org.id }, admin);
    } catch (e) {
      console.error("[calendar] re-sync after destination change:", e);
    }
  }
  revalidatePath("/integrations");
  return { ok: true };
}

const staffInput = z.object({ connectionId: z.string().uuid(), staffId: z.string().uuid().nullable() });

/** "This calendar belongs to". Bookings already mirrored under the old
    scope move on the next sync of each (the reconcile compares target vs
    state), so both the old and the new scope are re-queued. */
export async function setConnectionStaff(input: unknown): Promise<ActionResult> {
  const parsed = staffInput.safeParse(input);
  if (!parsed.success) return invalid();
  const { org, admin, connection } = await ownConnection(parsed.data.connectionId);
  if (!connection) return invalid();
  if (parsed.data.staffId) {
    const { data } = await admin.from("staff").select("id").eq("id", parsed.data.staffId).eq("org_id", org.id).maybeSingle();
    if (!data) return invalid();
  }
  const { error } = await admin
    .from("calendar_connections")
    .update({ staff_id: parsed.data.staffId, updated_at: new Date().toISOString() })
    .eq("id", connection.id);
  if (error) return fail("setConnectionStaff", error);
  try {
    await requeueScope(org.id, connection.staffId, admin);
    await requeueScope(org.id, parsed.data.staffId, admin);
    await runCalendarSync({ orgId: org.id }, admin);
  } catch (e) {
    console.error("[calendar] re-sync after scope change:", e);
  }
  revalidatePath("/integrations");
  return { ok: true };
}

const disconnectInput = z.object({ connectionId: z.string().uuid() });

/** Removes the connection and the state rows that pointed at it. Events
    already in Google stay (spec 2026-09-05 §2.11) — the page says so before
    the click. */
export async function disconnectCalendar(input: unknown): Promise<ActionResult> {
  const parsed = disconnectInput.safeParse(input);
  if (!parsed.success) return invalid();
  const { admin, connection } = await ownConnection(parsed.data.connectionId);
  if (!connection) return invalid();
  const { error: stateError } = await admin.from("booking_calendar_events").delete().eq("connection_id", connection.id);
  if (stateError) return fail("disconnectCalendar state", stateError);
  const { error } = await admin.from("calendar_connections").delete().eq("id", connection.id);
  if (error) return fail("disconnectCalendar", error);
  revalidatePath("/integrations");
  return { ok: true };
}
