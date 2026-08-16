import { Check } from "lucide-react";
import { CalendarMock } from "./mocks/calendar-mock";

const POINTS = [
  "See every booking for the week at a glance",
  "Block time off with a drag — clients never see it",
  "Add walk-in or phone bookings in seconds",
];

export function ProductShowcase() {
  return (
    <section aria-labelledby="product-heading" className="border-t">
      <div className="mx-auto w-full max-w-6xl px-6 py-20 md:py-28">
        <div className="max-w-xl">
          <h2 id="product-heading" className="text-3xl font-semibold tracking-tight md:text-4xl">Your week, at a glance</h2>
          <p className="text-muted-foreground mt-3">One calendar for everything that&apos;s booked, blocked or free.</p>
        </div>
        <div className="mt-10">
          <CalendarMock />
        </div>
        <ul className="mt-8 grid gap-4 md:grid-cols-3">
          {POINTS.map((p) => (
            <li key={p} className="flex items-start gap-3 text-sm">
              <Check className="text-primary mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{p}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
