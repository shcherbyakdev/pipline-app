// The post-booking panel, shared by the appointment and rental flows.
// Plain markup — no state, no client hooks — so it inherits whichever
// boundary imports it.
export function BookingConfirmed({
  token,
  summary,
  staffName,
}: {
  token: string;
  summary?: { title: string; whenLine: string };
  /** Whom the booking landed with. Null for solo orgs — createBooking only
      names a person when the org actually has a team to tell apart. */
  staffName?: string | null;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-md border p-4">
      <h2 className="font-semibold">Booking confirmed</h2>
      {summary ? (
        <div>
          <p className="font-medium">{summary.title}</p>
          <p>{summary.whenLine}</p>
        </div>
      ) : null}
      {staffName ? <p className="text-sm">with {staffName}</p> : null}
      <p className="text-muted-foreground text-sm">
        A confirmation email is on its way. Keep it — the links below are your access to this
        booking.
      </p>
      {/* New tab: inside the website embed these would otherwise navigate
          the iframe itself into the manage page (audit 2026-08-24). */}
      <a className="text-sm underline" href={`/booking/${token}`} target="_blank" rel="noopener">
        View your booking
      </a>
      <a className="text-sm underline" href={`/booking/${token}/calendar.ics`} target="_blank" rel="noopener">
        Add to calendar (.ics)
      </a>
    </div>
  );
}
