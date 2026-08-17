// The post-booking panel, shared by the appointment and rental flows.
// Plain markup — no state, no client hooks — so it inherits whichever
// boundary imports it.
export function BookingConfirmed({ token }: { token: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-md border p-4">
      <h2 className="font-semibold">Booking confirmed</h2>
      <p className="text-muted-foreground text-sm">
        A confirmation email is on its way. Keep it — the links below are your access to this
        booking.
      </p>
      <a className="text-sm underline" href={`/booking/${token}`}>
        View your booking
      </a>
      <a className="text-sm underline" href={`/booking/${token}/calendar.ics`}>
        Add to calendar (.ics)
      </a>
    </div>
  );
}
