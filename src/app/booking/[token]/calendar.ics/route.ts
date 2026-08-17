import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { clientKeyFrom } from "@/lib/tokens";
import { resolveBookingToken, buildBookingManageUrl } from "@/lib/tokens/booking";
import { bookingIcs } from "@/features/scheduling/ics";
import { resolveClientStaffName } from "@/lib/booking/public";

export async function GET(
  _req: Request,
  ctx: RouteContext<"/booking/[token]/calendar.ics">,
) {
  const { token } = await ctx.params;
  const result = await resolveBookingToken(token, clientKeyFrom(await headers()));
  if (result.status !== "ok" || result.booking.status !== "confirmed") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const b = result.booking;
  const manageUrl = buildBookingManageUrl(token);
  const ics = bookingIcs({
    uid: b.id,
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
