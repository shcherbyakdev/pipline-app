import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhone } from "@/features/scheduling/schema";

/* The admin create actions' phone (0086). Their RPCs predate the column and
   take no p_phone — three more ~100-line definer bodies were not worth
   re-issuing for a pass-through — so the phone is stamped on the fresh row
   after the RPC, as service_role, the way stampBookingLocale (0072) writes
   the client's language. The org filter is belt-and-braces: the id came
   back from an RPC that only ever creates rows in the caller's org.

   Best-effort like everything past the RPC: the booking is committed and
   nothing here may fail the action. */
export async function stampBookingPhone(bookingId: string, orgId: string, phone: string | null | undefined): Promise<void> {
  const clientPhone = normalizePhone(phone);
  if (!clientPhone) return;
  const { error } = await createAdminClient()
    .from("bookings")
    .update({ client_phone: clientPhone })
    .eq("id", bookingId)
    .eq("org_id", orgId);
  if (error) console.error("[bookings] phone stamp failed:", error);
}
