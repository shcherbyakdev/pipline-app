"use client";

import * as React from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import type { PublicOffering, PublicService } from "@/lib/booking/public";
import { getSlots, createBooking } from "@/features/scheduling/public-actions";
import { BookingConfirmed } from "@/features/scheduling/components/booking-confirmed";
import { ClientDetailsFields } from "@/features/scheduling/components/client-details-fields";
import { RentalBookingFlow } from "@/features/rentals/components/rental-booking-flow";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function BookingWidget({
  handle,
  orgTimeZone,
  services,
  offerings = [],
  preview,
}: {
  handle: string;
  orgTimeZone: string;
  services: PublicService[];
  offerings?: PublicOffering[];
  preview?: { slots: string[] };
}) {
  // Auto-select only when there is genuinely nothing to choose between —
  // one service AND no rentals (or vice versa below).
  const [service, setService] = React.useState<PublicService | null>(
    services.length === 1 && offerings.length === 0 ? services[0] : null,
  );
  const [offering, setOffering] = React.useState<PublicOffering | null>(
    services.length === 0 && offerings.length === 1 ? offerings[0] : null,
  );
  const [slots, setSlots] = React.useState<string[]>([]);
  const [fromDate, setFromDate] = React.useState(todayISO());
  const [slot, setSlot] = React.useState<string | null>(null);
  const [doneToken, setDoneToken] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const slotsRegionRef = React.useRef<HTMLDivElement>(null);

  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit", month: "short" });
  const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

  const loadSlots = React.useCallback(
    (svc: PublicService, from: string) => {
      // Preview mode (settings live preview): no server action, no network —
      // just echo the canned slots through the same async-transition shape
      // the real path uses, so this stays a single code path for the effect
      // below (and doesn't trip the set-state-in-effect lint rule, which the
      // real branch already satisfies the same way).
      if (preview) {
        startTransition(async () => {
          setSlots(preview.slots);
        });
        return;
      }
      startTransition(async () => {
        setError(null);
        const result = await getSlots({ handle, serviceId: svc.id, fromDate: from, days: 7 });
        if (result.ok) setSlots(result.slots);
        else setError(result.error);
      });
    },
    [handle, preview],
  );

  React.useEffect(() => {
    if (service) loadSlots(service, fromDate);
  }, [service, fromDate, loadSlots]);

  function submit(formData: FormData) {
    if (preview) return;
    if (!service || !slot) return;
    startTransition(async () => {
      setError(null);
      const result = await createBooking({
        handle,
        serviceId: service.id,
        startsAt: slot,
        name: String(formData.get("name") ?? ""),
        email: String(formData.get("email") ?? ""),
        note: String(formData.get("note") ?? "") || undefined,
      });
      if (result.ok) {
        setDoneToken(result.token);
      } else {
        setError(result.error);
        if ("slotTaken" in result && result.slotTaken) {
          setSlot(null);
          loadSlots(service, fromDate);
        }
      }
    });
  }

  // Rentals are a separate flow end-to-end (date ranges, units, org-local
  // times) — hand the whole widget over once an offering is picked.
  if (offering) {
    return (
      <RentalBookingFlow
        handle={handle}
        orgTimeZone={orgTimeZone}
        offering={offering}
        onBack={services.length + offerings.length > 1 ? () => setOffering(null) : null}
      />
    );
  }

  if (doneToken) return <BookingConfirmed token={doneToken} />;

  // Group by the VIEWER's local date, not the UTC date — a late-evening
  // slot in the viewer's zone must appear under the day they'd call it.
  const viewerDayKey = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const byDay = new Map<string, string[]>();
  for (const s of slots) {
    const day = viewerDayKey.format(new Date(s));
    byDay.set(day, [...(byDay.get(day) ?? []), s]);
  }

  return (
    <div className="flex flex-col gap-6">
      {!service ? (
        <div className="flex flex-col gap-6">
          {services.length > 0 ? (
            <div className="flex flex-col gap-2">
              {/* Headings only when there is something to tell apart. */}
              {offerings.length > 0 ? (
                <h2 className="text-muted-foreground text-sm font-medium">Appointments</h2>
              ) : null}
              <ul className="flex flex-col gap-2">
                {services.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => {
                        flushSync(() => setService(s));
                        slotsRegionRef.current?.focus();
                      }}
                      className="wt-surface flex w-full items-center justify-between rounded-md border px-4 py-3 text-left text-sm"
                    >
                      <span>
                        <span className="font-medium">{s.name}</span>
                        {s.description ? (
                          <span className="text-muted-foreground block text-xs">
                            {s.description}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                        {s.durationMin} min{s.priceLabel ? ` · ${s.priceLabel}` : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {offerings.length > 0 ? (
            <div className="flex flex-col gap-2">
              {services.length > 0 ? (
                <h2 className="text-muted-foreground text-sm font-medium">Stays &amp; rentals</h2>
              ) : null}
              <ul className="flex flex-col gap-2">
                {offerings.map((o) => (
                  <li key={o.id}>
                    <button
                      type="button"
                      onClick={() => setOffering(o)}
                      className="wt-surface flex w-full items-center justify-between rounded-md border px-4 py-3 text-left text-sm"
                    >
                      <span>
                        <span className="font-medium">{o.name}</span>
                        {o.description ? (
                          <span className="text-muted-foreground block text-xs">
                            {o.description}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                        {[
                          o.priceLabel,
                          o.minStay > 1 ? `min ${o.minStay} ${o.rangeMode}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : !slot ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              {service.name}{" "}
              {services.length + offerings.length > 1 ? (
                <button
                  type="button"
                  className="text-muted-foreground underline"
                  onClick={() => {
                    setService(null);
                    setSlots([]);
                  }}
                >
                  change
                </button>
              ) : null}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="wt-surface"
                disabled={fromDate <= todayISO()}
                onClick={() => setFromDate(shiftDays(fromDate, -7))}
              >
                ←
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="wt-surface"
                onClick={() => setFromDate(shiftDays(fromDate, 7))}
              >
                →
              </Button>
            </div>
          </div>
          <div ref={slotsRegionRef} tabIndex={-1} aria-live="polite" className="flex flex-col gap-4">
            {pending ? (
              <p className="text-muted-foreground text-sm">Loading times…</p>
            ) : byDay.size === 0 ? (
              <p className="text-muted-foreground text-sm">No free times this week — try the next.</p>
            ) : (
              [...byDay.entries()].map(([day, daySlots]) => (
                <div key={day} className="flex flex-col gap-2">
                  <p className="text-muted-foreground text-xs font-medium">
                    {dayFmt.format(new Date(daySlots[0]))}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {daySlots.map((s) => (
                      <Button
                        key={s}
                        variant="outline"
                        size="sm"
                        className="wt-surface"
                        onClick={() => setSlot(s)}
                        aria-label={`${dayFmt.format(new Date(s))}, ${timeFmt.format(new Date(s))}`}
                      >
                        {timeFmt.format(new Date(s))}
                      </Button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
          <p className="text-muted-foreground text-xs">Times shown in your timezone ({viewerTz}).</p>
          {viewerTz !== orgTimeZone ? (
            <p className="text-muted-foreground text-xs">
              The organisation&apos;s local timezone is {orgTimeZone}.
            </p>
          ) : null}
        </div>
      ) : (
        <form action={submit} className="flex flex-col gap-4">
          <p className="text-sm">
            <span className="font-medium">{service.name}</span> —{" "}
            {dayFmt.format(new Date(slot))}, {timeFmt.format(new Date(slot))}{" "}
            <button type="button" className="text-muted-foreground underline" onClick={() => setSlot(null)}>
              change
            </button>
          </p>
          <ClientDetailsFields />
          <Button type="submit" className="wt-primary" disabled={pending || !!preview}>
            {preview ? "Preview" : pending ? "Booking…" : "Confirm booking"}
          </Button>
        </form>
      )}
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </div>
  );
}

function shiftDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
}
