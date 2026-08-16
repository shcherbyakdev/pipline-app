"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { PublicService } from "@/lib/booking/public";
import { getSlots, createBooking } from "@/features/scheduling/public-actions";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function BookingWidget({
  handle,
  orgTimeZone,
  services,
}: {
  handle: string;
  orgTimeZone: string;
  services: PublicService[];
}) {
  const [service, setService] = React.useState<PublicService | null>(
    services.length === 1 ? services[0] : null,
  );
  const [slots, setSlots] = React.useState<string[]>([]);
  const [fromDate, setFromDate] = React.useState(todayISO());
  const [slot, setSlot] = React.useState<string | null>(null);
  const [doneToken, setDoneToken] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit", month: "short" });
  const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

  const loadSlots = React.useCallback(
    (svc: PublicService, from: string) => {
      startTransition(async () => {
        setError(null);
        const result = await getSlots({ handle, serviceId: svc.id, fromDate: from, days: 7 });
        if (result.ok) setSlots(result.slots);
        else setError(result.error);
      });
    },
    [handle],
  );

  React.useEffect(() => {
    if (service) loadSlots(service, fromDate);
  }, [service, fromDate, loadSlots]);

  function submit(formData: FormData) {
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

  if (doneToken) {
    return (
      <div className="flex flex-col gap-3 rounded-md border p-4">
        <h2 className="font-semibold">Booking confirmed</h2>
        <p className="text-muted-foreground text-sm">
          A confirmation email is on its way. Keep it — the links below are your access to this
          booking.
        </p>
        <a className="text-sm underline" href={`/booking/${doneToken}`}>
          View your booking
        </a>
        <a className="text-sm underline" href={`/booking/${doneToken}/calendar.ics`}>
          Add to calendar (.ics)
        </a>
      </div>
    );
  }

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
        <ul className="flex flex-col gap-2">
          {services.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => setService(s)}
                className="hover:bg-accent/50 flex w-full items-center justify-between rounded-md border px-4 py-3 text-left text-sm"
              >
                <span>
                  <span className="font-medium">{s.name}</span>
                  {s.description ? (
                    <span className="text-muted-foreground block text-xs">{s.description}</span>
                  ) : null}
                </span>
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                  {s.durationMin} min{s.priceLabel ? ` · ${s.priceLabel}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : !slot ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              {service.name}{" "}
              <button
                type="button"
                className="text-muted-foreground underline"
                onClick={() => {
                  setService(services.length === 1 ? service : null);
                  setSlots([]);
                }}
              >
                {services.length > 1 ? "change" : ""}
              </button>
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={fromDate <= todayISO()}
                onClick={() => setFromDate(shiftDays(fromDate, -7))}
              >
                ←
              </Button>
              <Button variant="outline" size="sm" onClick={() => setFromDate(shiftDays(fromDate, 7))}>
                →
              </Button>
            </div>
          </div>
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
                    <Button key={s} variant="outline" size="sm" onClick={() => setSlot(s)}>
                      {timeFmt.format(new Date(s))}
                    </Button>
                  ))}
                </div>
              </div>
            ))
          )}
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
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" required maxLength={200} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required maxLength={320} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="note">Note (optional)</Label>
            <Textarea id="note" name="note" maxLength={2000} rows={3} />
          </div>
          <Button type="submit" className="wt-primary" disabled={pending}>
            {pending ? "Booking…" : "Confirm booking"}
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
