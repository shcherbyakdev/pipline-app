import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectTransport, type EmailTransport } from "@/lib/email/transport";
import { emailTranslators } from "@/i18n/emails";
import {
  providerCancelledEmail,
  providerNewBookingEmail,
  providerRescheduledEmail,
} from "@/features/scheduling/templates";
import { parseMemberPrefs, type MemberEvent } from "./prefs";
import { sendPush, type PushPayload } from "./push";

/* The one seam for "tell the org's people" (spec 2026-09-05 §3.7). Replaced
   the seven provider-notice send sites: each used to look the owner's
   address up and send one email; now each hands the same structured payload
   here, and every member gets what THEY asked for — email, push, both or
   nothing — per event (org_members.notification_prefs, 0075).

   Doctrine unchanged from the sites it replaced: best-effort, never throws.
   The booking is already committed when this runs; a notice that fails is
   logged and the caller carries on. Each member and each channel sits in
   its own try so nothing short-circuits anything else. */

export type MemberNotice =
  | {
      event: "newBooking" | "newRequest";
      serviceName: string;
      clientName: string;
      clientEmail: string;
      whenLine: string;
      staffName?: string | null;
      note?: string | null;
      /** H3 total / deposit / policy lines (rentals); absent for appointments. */
      infoLines?: string[];
    }
  | { event: "cancelled"; serviceName: string; clientName: string; clientEmail?: string | null; whenLine: string }
  | {
      event: "rescheduled";
      serviceName: string;
      clientName: string;
      clientEmail?: string | null;
      whenLine: string;
      oldWhenLine: string;
    };

export type NotifyInput = MemberNotice & {
  orgId: string;
  /** Stable per logical send (bookingLifecycleKey); the email transport
      dedupes on it and the push uses it as the collapse tag. */
  idempotencyKey: string;
};

export type NotifyDeps = {
  db?: SupabaseClient;
  transport?: EmailTransport;
  push?: (userId: string, payload: PushPayload) => Promise<unknown>;
};

type MemberRow = { user_id: string; notification_prefs: unknown };

/** Where a tap on the push lands: a request waits in the Overview inbox,
    everything else is on the calendar. */
export function pushUrlFor(event: MemberEvent): string {
  return event === "newRequest" ? "/overview" : "/bookings";
}

export async function notifyMembers(input: NotifyInput, deps: NotifyDeps = {}): Promise<void> {
  try {
    const db = deps.db ?? createAdminClient();
    const push = deps.push ?? sendPush;

    const [{ data: members, error: membersError }, { data: org }] = await Promise.all([
      db.from("org_members").select("user_id, notification_prefs").eq("org_id", input.orgId),
      db.from("orgs").select("name, locale").eq("id", input.orgId).maybeSingle(),
    ]);
    if (membersError) throw membersError;
    if (!members || members.length === 0) return;

    // The org's language for every member (spec D4, as the provider mails
    // always were). Translated once, sent to each.
    const mail = await emailTranslators(org?.locale);
    let email: { subject: string; html: string; text: string } | null = null;
    const emailFor = () => {
      if (email) return email;
      if (input.event === "cancelled") {
        email = providerCancelledEmail(mail.t, { serviceName: input.serviceName, whenLine: input.whenLine, clientName: input.clientName });
      } else if (input.event === "rescheduled") {
        email = providerRescheduledEmail(mail.t, {
          serviceName: input.serviceName,
          oldWhenLine: input.oldWhenLine,
          whenLine: input.whenLine,
          clientName: input.clientName,
        });
      } else {
        email = providerNewBookingEmail(mail.t, {
          serviceName: input.serviceName,
          clientName: input.clientName,
          clientEmail: input.clientEmail,
          whenLine: input.whenLine,
          staffName: input.staffName,
          note: input.note,
          infoLines: input.infoLines,
          pending: input.event === "newRequest",
        });
      }
      return email;
    };
    const pushPayload: PushPayload = {
      title: mail.t(`push.${input.event}.title`),
      body: mail.t(`push.${input.event}.body`, { client: input.clientName, service: input.serviceName, when: input.whenLine }),
      url: pushUrlFor(input.event),
      tag: input.idempotencyKey,
    };

    for (const member of (members ?? []) as MemberRow[]) {
      const prefs = parseMemberPrefs(member.notification_prefs)[input.event];

      if (prefs.email) {
        try {
          const { data: user, error: userError } = await db.auth.admin.getUserById(member.user_id);
          if (userError) throw userError;
          const to = user.user?.email;
          if (to) {
            const msg = emailFor();
            await (deps.transport ?? selectTransport()).send({
              to,
              subject: msg.subject,
              html: msg.html,
              text: msg.text,
              // Replies go to the client, not the platform's no-reply sender.
              replyTo: input.clientEmail ?? undefined,
              // One key per member: the transport dedupes per recipient.
              idempotencyKey: members.length === 1 ? input.idempotencyKey : `${input.idempotencyKey}:${member.user_id}`,
            });
          }
        } catch (error) {
          console.error(`[notifications] ${input.event} email failed:`, error);
        }
      }

      if (prefs.push) {
        try {
          await push(member.user_id, pushPayload);
        } catch (error) {
          console.error(`[notifications] ${input.event} push failed:`, error);
        }
      }
    }
  } catch (error) {
    console.error(`[notifications] ${input.event} notice failed:`, error);
  }
}
