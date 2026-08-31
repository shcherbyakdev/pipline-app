import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { clientKeyFrom } from "@/lib/tokens";
import { resolveBookingToken } from "@/lib/tokens/booking";
import { resolveClientStaffName } from "@/lib/booking/public";
import { whenLineFor } from "@/features/scheduling/templates";
import { ManageBooking } from "@/features/scheduling/components/manage-booking";
import { moneyInfoLines } from "@/features/rentals/pricing";

const STATUS_LINE: Record<string, string> = {
  confirmed: "Confirmed",
  pending: "Waiting for confirmation",
  declined: "Request declined",
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
  // H3: money lines (total/deposit/cancel-window) for the booking card.
  const infoLines = moneyInfoLines({
    totalCents: b.priceCents,
    depositCents: b.depositCents,
    currency: b.currency,
    cancelWindowMin: b.cancelWindowMin ?? 0,
  });
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const isInFuture = b.startsAt.getTime() > now;
  // H3: appointments (rentalUnitId null) and offerings with no cancel window
  // are always cancellable — the gate only bites a rental past its
  // free-cancellation deadline (the RPC's cancel_booking is the backstop).
  const canCancel =
    b.rentalUnitId === null ||
    !b.cancelWindowMin ||
    now <= b.startsAt.getTime() - b.cancelWindowMin * 60_000;
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 p-6">
      <h1 className="text-lg font-semibold">{b.orgName}</h1>
      <div className="flex flex-col gap-1 rounded-md border p-4 text-sm">
        <p className="font-medium">{b.serviceName}</p>
        {staffName ? <p className="text-muted-foreground">with {staffName}</p> : null}
        <p>
          {whenLineFor(
            {
              startsAt: b.startsAt,
              endsAt: b.endsAt,
              isRental: b.rentalUnitId !== null,
              rangeMode: b.rangeMode,
            },
            b.orgTimezone,
          )}
        </p>
        {infoLines.map((l) => (
          <p key={l} className="text-muted-foreground">
            {l}
          </p>
        ))}
        <p className="text-muted-foreground">
          {b.status === "pending" && !isInFuture
            ? "Request expired"
            : (STATUS_LINE[b.status] ?? b.status)}
        </p>
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
              canCancel={canCancel}
              kind={b.rentalUnitId === null ? "appointment" : "rental"}
              rangeMode={b.rangeMode}
            />
          ) : (
            <p className="text-muted-foreground text-xs">
              This booking has already started.
            </p>
          )}
        </>
      ) : null}
      {b.status === "pending" && isInFuture ? (
        <>
          <p className="text-muted-foreground text-sm">
            {b.orgName} hasn&rsquo;t confirmed this request yet — you&rsquo;ll get an email
            when they do.
          </p>
          <ManageBooking
            token={token}
            timeZone={b.orgTimezone}
            canReschedule={false}
            canCancel={true}
            kind={b.rentalUnitId === null ? "appointment" : "rental"}
            rangeMode={b.rangeMode}
            request
          />
        </>
      ) : null}
    </main>
  );
}
