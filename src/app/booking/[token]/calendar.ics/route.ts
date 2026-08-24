import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { clientKeyFrom } from "@/lib/tokens";
import { resolveBookingToken, buildBookingManageUrl } from "@/lib/tokens/booking";
import { bookingIcs } from "@/features/scheduling/ics";
import { getBookingChain, resolveClientStaffName } from "@/lib/booking/public";

export async function GET(
  _req: Request,
  ctx: RouteContext<"/booking/[token]/calendar.ics">,
) {
  const { token } = await ctx.params;
  const result = await resolveBookingToken(token, clientKeyFrom(await headers()));
  if (result.status !== "ok") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const b = result.booking;
  // Confirmed → the event. Cancelled → a CANCEL for the same UID, so a
  // calendar that re-fetches the link drops it. A rescheduled row's link is
  // stale by design (the new row has its own token) — 404.
  const cancelled = b.status === "cancelled_by_client" || b.status === "cancelled_by_provider";
  if (b.status !== "confirmed" && !cancelled) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const manageUrl = buildBookingManageUrl(token);
  const chain = await getBookingChain(b.id);
  const ics = bookingIcs({
    // One UID per appointment across reschedules; SEQUENCE grows with each
    // move (and once more for a cancellation) so calendar apps replace
    // rather than duplicate.
    uid: chain.rootId,
    sequence: chain.depth + (cancelled ? 1 : 0),
    cancelled,
    starts: b.startsAt,
    ends: b.endsAt,
    summary: `${b.serviceName} — ${b.orgName}`,
    description: `Manage: ${manageUrl}`,
    url: manageUrl,
    // Team: "… with Anna" in the event title; null (unchanged title) on solo.
    staffName: await resolveClientStaffName(b.orgId, b.staffName),
  });
  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="booking.ics"',
    },
  });
}
