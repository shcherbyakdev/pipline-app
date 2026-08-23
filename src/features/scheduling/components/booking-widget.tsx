"use client";

import * as React from "react";
import { flushSync } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import type { PublicOffering, PublicService, PublicStaff } from "@/lib/booking/public";
import { initials } from "@/features/scheduling/staff-slug";
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
  staff = [],
  serviceStaffIds,
  lockedStaff = null,
  preview,
  requestedService = null,
}: {
  handle: string;
  orgTimeZone: string;
  services: PublicService[];
  offerings?: PublicOffering[];
  /** Active staff of the org, unfiltered. Empty only in preview mode. */
  staff?: PublicStaff[];
  /** serviceId → eligible staff ids; absent means "every staff member". */
  serviceStaffIds?: Record<string, string[]>;
  /** Per-staff page / `?staff=`: skips the staff step, offers no "Anyone". */
  lockedStaff?: PublicStaff | null;
  preview?: { slots: string[] };
  /** Booking-page hand-off (services section / `?service=`): each request
      carries a key so re-picking the same service after "change" still applies. */
  requestedService?: { id: string; key: number } | null;
}) {
  // Who can take this service. Declared before the state below because the
  // lazy initialiser for `staffChoice` has to answer the same question for an
  // auto-selected service.
  const eligibleFor = (svc: PublicService) =>
    serviceStaffIds ? staff.filter((s) => (serviceStaffIds[svc.id] ?? []).includes(s.id)) : staff;
  // The solo rule: one eligible person (or a locked one) means no step, no
  // "with X" anywhere — the widget renders exactly as it did before teams.
  const needsStaffStep = (svc: PublicService) => !lockedStaff && eligibleFor(svc).length > 1;
  // With exactly one eligible person we pass that id, not "any", so the RPC
  // does the strict named check rather than auto-assigning.
  const resolveStaff = (svc: PublicService): string | null =>
    needsStaffStep(svc) ? null : (lockedStaff?.id ?? eligibleFor(svc)[0]?.id ?? "any");

  // Auto-select only when there is genuinely nothing to choose between —
  // one service AND no rentals (or vice versa below).
  const autoService = services.length === 1 && offerings.length === 0 ? services[0] : null;
  const [service, setService] = React.useState<PublicService | null>(autoService);
  const [staffChoice, setStaffChoice] = React.useState<string | "any" | null>(() =>
    lockedStaff ? lockedStaff.id : autoService ? resolveStaff(autoService) : null,
  );
  const [offering, setOffering] = React.useState<PublicOffering | null>(
    services.length === 0 && offerings.length === 1 ? offerings[0] : null,
  );
  // Preview mode (settings live preview) has its slots up front — seed them
  // so date navigation never passes through a loading state (which flashed
  // the list away for a frame).
  const [slots, setSlots] = React.useState<string[]>(preview?.slots ?? []);
  const [fromDate, setFromDate] = React.useState(todayISO());
  const [slot, setSlot] = React.useState<string | null>(null);
  const [doneToken, setDoneToken] = React.useState<string | null>(null);
  // Whom the RPC actually assigned — null for solo orgs, so the confirmation
  // stays wordless there.
  const [doneStaffName, setDoneStaffName] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const slotsRegionRef = React.useRef<HTMLDivElement>(null);
  const staffRegionRef = React.useRef<HTMLDivElement>(null);

  // Apply a requested service once per request key, during render (React's
  // sanctioned "adjust state on prop change"). Mirrors the service-card click
  // handler below minus the focus move — the caller scrolls instead.
  const [appliedRequestKey, setAppliedRequestKey] = React.useState<number | null>(null);
  if (requestedService && requestedService.key !== appliedRequestKey) {
    setAppliedRequestKey(requestedService.key);
    const requested = services.find((s) => s.id === requestedService.id);
    if (requested) {
      setService(requested);
      setStaffChoice(resolveStaff(requested));
      setOffering(null);
      setSlot(null);
    }
  }

  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit", month: "short" });
  const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

  const loadSlots = React.useCallback(
    (svc: PublicService, from: string, staffId: string) => {
      // Preview mode: no server action, no network, and the canned slots are
      // already in state (seeded above) — nothing to load.
      if (preview) return;
      startTransition(async () => {
        setError(null);
        const result = await getSlots({ handle, serviceId: svc.id, fromDate: from, days: 7, staffId });
        if (result.ok) setSlots(result.slots);
        else setError(result.error);
      });
    },
    [handle, preview],
  );

  React.useEffect(() => {
    // No fetch until the staff question is settled — an unanswered staff step
    // would otherwise load the union and then reload it narrowed.
    if (service && staffChoice) loadSlots(service, fromDate, staffChoice);
  }, [service, staffChoice, fromDate, loadSlots]);

  function submit(formData: FormData) {
    if (preview) return;
    if (!service || !slot || !staffChoice) return;
    startTransition(async () => {
      setError(null);
      const result = await createBooking({
        handle,
        serviceId: service.id,
        staffId: staffChoice,
        startsAt: slot,
        name: String(formData.get("name") ?? ""),
        email: String(formData.get("email") ?? ""),
        note: String(formData.get("note") ?? "") || undefined,
      });
      if (result.ok) {
        setDoneToken(result.token);
        setDoneStaffName(result.staffName);
      } else {
        setError(result.error);
        if ("slotTaken" in result && result.slotTaken) {
          setSlot(null);
          loadSlots(service, fromDate, staffChoice);
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

  if (doneToken) return <BookingConfirmed token={doneToken} staffName={doneStaffName} />;

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

  // Whom this booking is with, or null when there is nothing worth saying —
  // a solo org (or one eligible person) must read exactly as it did before
  // teams existed, so no "with X" line appears at all.
  const chosenStaff = staffChoice && staffChoice !== "any" ? staff.find((s) => s.id === staffChoice) : undefined;
  const withLabel = lockedStaff
    ? lockedStaff.name
    : service && needsStaffStep(service)
      ? (staffChoice === "any" ? "Anyone" : (chosenStaff?.name ?? null))
      : null;
  // Only a choice the visitor made is re-openable; a locked staff member is
  // the whole point of the link they followed.
  const canChangeStaff = !lockedStaff && !!service && needsStaffStep(service);

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
                        const next = resolveStaff(s);
                        flushSync(() => {
                          setService(s);
                          setStaffChoice(next);
                        });
                        // Focus whichever region actually came next, so the
                        // service list's disappearance never drops focus to
                        // <body>.
                        (next ? slotsRegionRef : staffRegionRef).current?.focus();
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
      ) : staffChoice === null ? (
        // tabIndex=-1 so the handlers that reveal this step can move focus
        // here; aria-live announces it for the same reason the slots region
        // does — the step replaces the list the user just acted on.
        <div
          ref={staffRegionRef}
          tabIndex={-1}
          aria-live="polite"
          className="flex flex-col gap-3"
        >
          <p className="text-sm font-medium">
            {service.name}{" "}
            {services.length + offerings.length > 1 ? (
              <button
                type="button"
                className="text-muted-foreground underline"
                onClick={() => {
                  setService(null);
                  setStaffChoice(null);
                  setSlots(preview?.slots ?? []);
                }}
              >
                change
              </button>
            ) : null}
          </p>
          <p className="text-muted-foreground text-sm">Who would you like to book with?</p>
          <ul className="flex flex-col gap-2">
            <li>
              <button
                type="button"
                className="wt-surface flex w-full items-center gap-3 rounded-md border px-4 py-3 text-left text-sm"
                onClick={() => {
                  flushSync(() => setStaffChoice("any"));
                  slotsRegionRef.current?.focus();
                }}
              >
                <span className="font-medium">Anyone available</span>
                <span className="text-muted-foreground ml-auto text-xs">most times</span>
              </button>
            </li>
            {eligibleFor(service).map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className="wt-surface flex w-full items-center gap-3 rounded-md border px-4 py-3 text-left text-sm"
                  onClick={() => {
                    flushSync(() => setStaffChoice(s.id));
                    slotsRegionRef.current?.focus();
                  }}
                >
                  <span
                    aria-hidden
                    className="inline-flex size-6 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                    style={{ background: s.color }}
                  >
                    {initials(s.name)}
                  </span>
                  <span className="font-medium">{s.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : !slot ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              {service.name}
              {withLabel ? (
                // "with X" when the person is fixed by the link, "· X" when
                // it's the visitor's own pick and the dot separates two
                // choices they can each re-open.
                <span className="text-muted-foreground">
                  {lockedStaff ? " with " : " · "}
                  {withLabel}
                </span>
              ) : null}{" "}
              {canChangeStaff ? (
                <button
                  type="button"
                  className="text-muted-foreground underline"
                  onClick={() => {
                    flushSync(() => {
                      setStaffChoice(null);
                      setSlots(preview?.slots ?? []);
                    });
                    staffRegionRef.current?.focus();
                  }}
                >
                  change
                </button>
              ) : services.length + offerings.length > 1 ? (
                <button
                  type="button"
                  className="text-muted-foreground underline"
                  onClick={() => {
                    setService(null);
                    setStaffChoice(lockedStaff?.id ?? null);
                    setSlots(preview?.slots ?? []);
                  }}
                >
                  change
                </button>
              ) : null}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="icon-sm"
                className="wt-surface"
                aria-label="Previous week"
                title="Previous week"
                disabled={fromDate <= todayISO()}
                onClick={() => setFromDate(shiftDays(fromDate, -7))}
              >
                <HugeiconsIcon icon={ArrowLeft01Icon} size={16} />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                className="wt-surface"
                aria-label="Next week"
                title="Next week"
                onClick={() => setFromDate(shiftDays(fromDate, 7))}
              >
                <HugeiconsIcon icon={ArrowRight01Icon} size={16} />
              </Button>
            </div>
          </div>
          {/* While a new week loads, the previous list stays put (dimmed) so
              the region doesn't collapse and re-expand — no flash. */}
          <div
            ref={slotsRegionRef}
            tabIndex={-1}
            aria-live="polite"
            aria-busy={pending || undefined}
            className={pending ? "flex flex-col gap-4 opacity-60 transition-opacity" : "flex flex-col gap-4"}
          >
            {pending && byDay.size === 0 ? (
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
            <span className="font-medium">{service.name}</span>
            {/* Same split as the header: "with Anna" only when the person is
                fixed by the link — "with Anyone" would be nonsense. */}
            {withLabel ? `${lockedStaff ? " with " : " · "}${withLabel}` : ""} —{" "}
            {dayFmt.format(new Date(slot))},{" "}
            {timeFmt.format(new Date(slot))}{" "}
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
