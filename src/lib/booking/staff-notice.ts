import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { selectTransport } from "@/lib/email/transport";
import {
  staffNewBookingEmail,
  providerCancelledEmail,
  providerRescheduledEmail,
} from "@/features/scheduling/templates";

export type StaffNoticeKind = "new" | "cancelled" | "rescheduled";

export type StaffNoticeInput = {
  orgId: string;
  staffId: string;
  kind: StaffNoticeKind;
  serviceName: string;
  clientName: string;
  whenLine: string;
  // Only the "rescheduled" kind reads this; falls back to whenLine so a
  // missing value degrades to "was X, now X" rather than throwing.
  oldWhenLine?: string;
  idempotencyKey: string;
};

// Best-effort "your calendar changed" note to the assigned staff member.
// Never throws: a booking must survive a mail failure (same doctrine as the
// client confirmation), and staff email is optional — a staff row without one
// is a silent no-op. The `:staff` suffix keeps this send distinct from the
// client's under the transport's dedupe key.
export async function sendStaffNotice(input: StaffNoticeInput): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: staff } = await admin
      .from("staff")
      .select("name, email")
      .eq("id", input.staffId)
      .eq("org_id", input.orgId)
      .maybeSingle();
    if (!staff?.email) return;

    let msg: { subject: string; html: string; text: string };
    if (input.kind === "new") {
      const { data: org } = await admin
        .from("orgs")
        .select("name")
        .eq("id", input.orgId)
        .maybeSingle();
      msg = staffNewBookingEmail({
        staffName: staff.name,
        orgName: org?.name ?? "",
        serviceName: input.serviceName,
        clientName: input.clientName,
        whenLine: input.whenLine,
      });
    } else if (input.kind === "cancelled") {
      msg = providerCancelledEmail({
        serviceName: input.serviceName,
        clientName: input.clientName,
        whenLine: input.whenLine,
      });
    } else {
      msg = providerRescheduledEmail({
        serviceName: input.serviceName,
        clientName: input.clientName,
        whenLine: input.whenLine,
        oldWhenLine: input.oldWhenLine ?? input.whenLine,
      });
    }

    await selectTransport().send({
      to: staff.email,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      idempotencyKey: `${input.idempotencyKey}:staff`,
    });
  } catch (error) {
    console.error("[scheduling] staff notice failed:", error);
  }
}
