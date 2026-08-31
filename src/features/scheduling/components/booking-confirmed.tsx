// The post-booking panel, shared by the appointment and rental flows.
// Plain markup — no state, no client hooks — so it inherits whichever
// boundary imports it.
export function BookingConfirmed({
  token,
  summary,
  staffName,
  pending,
}: {
  token: string;
  summary?: { title: string; whenLine: string };
  /** Whom the booking landed with. Null for solo orgs — createBooking only
      names a person when the org actually has a team to tell apart. */
  staffName?: string | null;
  /** Approval (0062): the service/space requires approval, so this landed as
      a REQUEST — nothing is booked and nothing is on a calendar yet. */
  pending?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-md border p-4">
      <h2 className="font-semibold">{pending ? "Request sent" : "Booking confirmed"}</h2>
      {summary ? (
        <div>
          <p className="font-medium">{summary.title}</p>
          <p>{summary.whenLine}</p>
        </div>
      ) : null}
      {staffName ? <p className="text-sm">with {staffName}</p> : null}
      <p className="text-muted-foreground text-sm">
        {pending
          ? "Nothing is booked yet — you'll get an email as soon as it's confirmed. Keep that email; the link below is your access to the request."
          : "A confirmation email is on its way. Keep it — the links below are your access to this booking."}
      </p>
      {/* New tab: inside the website embed these would otherwise navigate
          the iframe itself into the manage page (audit 2026-08-24). */}
      <a className="text-sm underline" href={`/booking/${token}`} target="_blank" rel="noopener">
        {pending ? "View your request" : "View your booking"}
      </a>
      {/* No .ics while pending — nothing is on anyone's calendar yet. */}
      {pending ? null : (
        <a className="text-sm underline" href={`/booking/${token}/calendar.ics`} target="_blank" rel="noopener">
          Add to calendar (.ics)
        </a>
      )}
    </div>
  );
}
