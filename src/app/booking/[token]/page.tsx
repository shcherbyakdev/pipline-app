import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { clientKeyFrom } from "@/lib/tokens";
import { resolveBookingToken } from "@/lib/tokens/booking";
import { getBookingOfferingId, getPublicOfferingById, resolveClientStaffName } from "@/lib/booking/public";
import { whenLineFor } from "@/features/scheduling/templates";
import { ManageBooking } from "@/features/scheduling/components/manage-booking";

const STATUS_LINE: Record<string, string> = {
  confirmed: "Confirmed",
  cancelled_by_client: "Cancelled",
  cancelled_by_provider: "Cancelled by the provider",
  rescheduled: "Rescheduled",
};

export default async function BookingManagePage({ params }: PageProps<"/booking/[token]">) {
  const { token } = await params;
  const result = await resolveBookingToken(token, clientKeyFrom(await headers()));
  if (result.status === "rate_limited") {
    return (
      <main className="mx-auto w-full max-w-md p-6">
        <p className="text-muted-foreground text-sm">Too many requests — try again shortly.</p>
      </main>
    );
  }
  if (result.status !== "ok") notFound();
  const b = result.booking;
  // Team: name the staff member the booking belongs to. Solo orgs collapse to
  // null, so the card reads exactly as it did before the team slice.
  const staffName = await resolveClientStaffName(b.orgId, b.staffName);
  // eslint-disable-next-line react-hooks/purity
  const isInFuture = b.startsAt.getTime() > Date.now();
  // Which rental reschedule surface ManageBooking mounts (H2): the range
  // picker (nights/days) or the hourly time grid. Only fetched when it's
  // actually going to be read — resolveBookingToken's own row already
  // carries a rangeMode field, but it's typed nights/days-only (pre-H2) and
  // this mirrors the offering lookup manage-actions.ts itself does rather
  // than widen a type read from several other surfaces.
  let rangeMode: "nights" | "days" | "hours" | null = null;
  if (b.status === "confirmed" && isInFuture && b.rentalUnitId !== null) {
    const offeringId = await getBookingOfferingId(b.id);
    const offering = offeringId !== null ? await getPublicOfferingById(b.orgId, offeringId) : null;
    rangeMode = offering?.rangeMode ?? null;
  }
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 p-6">
      <h1 className="text-lg font-semibold">{b.orgName}</h1>
      <div className="flex flex-col gap-1 rounded-md border p-4 text-sm">
        <p className="font-medium">{b.serviceName}</p>
        {staffName ? <p className="text-muted-foreground">with {staffName}</p> : null}
        <p>
          {whenLineFor(
            { startsAt: b.startsAt, endsAt: b.endsAt, isRental: b.rentalUnitId !== null },
            b.orgTimezone,
          )}
        </p>
        <p className="text-muted-foreground">{STATUS_LINE[b.status] ?? b.status}</p>
      </div>
      {b.status === "confirmed" ? (
        <>
          <a className="text-sm underline" href={`/booking/${token}/calendar.ics`}>
            Add to calendar (.ics)
          </a>
          {isInFuture ? (
            <ManageBooking
              token={token}
              timeZone={b.orgTimezone}
              // Rentals R2: a stay reschedules through its own range picker
              // (reschedule_rental_booking), an appointment through the slot
              // grid — both are self-serve.
              canReschedule={true}
              kind={b.rentalUnitId === null ? "appointment" : "rental"}
              rangeMode={rangeMode}
            />
          ) : (
            <p className="text-muted-foreground text-xs">
              This booking has already started.
            </p>
          )}
        </>
      ) : null}
    </main>
  );
}
