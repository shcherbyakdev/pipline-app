"use client";

import * as React from "react";
import { flushSync } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { PublicOffering, PublicService, PublicStaff } from "@/lib/booking/public";
import { getSlots, createBooking } from "@/features/scheduling/public-actions";
import { firstDayBeyond, firstLookDays, homeWindow, windowAround, type SlotWindow } from "@/features/scheduling/slot-paging";
import { SlotPicker } from "@/features/scheduling/components/slot-layouts/slot-picker";
import type { RangeAvailability } from "@/features/rentals/range";
import type { SlotLayout, StayLayout } from "@/lib/widget-theme";
import { BookingConfirmed } from "@/features/scheduling/components/booking-confirmed";
import { ClientDetailsFields } from "@/features/scheduling/components/client-details-fields";
import { StaffSwitch } from "@/features/scheduling/components/staff-switch";
import { staffOffers } from "@/features/scheduling/staff-offers";
import { RentalBookingFlow } from "@/features/rentals/components/rental-booking-flow";
import { HourlyBookingFlow } from "@/features/rentals/components/hourly-booking-flow";
import { formatOfferingPrice, stayHint } from "@/features/rentals/pricing";
import { INTL_LOCALES } from "@/i18n/config";
import { cn } from "@/lib/utils";
import { CHANGE_LINK, PANEL, ROW, STEP_LABEL } from "@/features/booking-page/render/type";

// The VIEWER's local date (audit 2026-08-24: the UTC date sent a far-west
// evening visitor one day ahead, hiding the rest of their own today with no
// way to page back). getSlots pads the engine window by a day on each side;
// the widget keeps what lands on its page.
const viewerDayFmt = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" });
const viewerDay = (iso: string) => viewerDayFmt.format(new Date(iso));
function todayISO(): string {
  return viewerDayFmt.format(new Date());
}

export function BookingWidget({
  handle,
  orgTimeZone,
  currency,
  services,
  offerings = [],
  staff = [],
  serviceStaffIds,
  requestedStaff = null,
  lockedStaff = null,
  preview,
  requestedService = null,
  requestedOffering = null,
  listServices = true,
  listStaff = true,
  listOfferings = true,
  layout = "calendar",
  stayLayout = "one-month",
}: {
  handle: string;
  orgTimeZone: string;
  /** Formats offering prices (formatOfferingPrice) — only ever rendered
      when `offerings` is non-empty, but every caller carries it regardless
      (getBookingOrg / getSchedulingSettings both return it). */
  currency: string;
  services: PublicService[];
  offerings?: PublicOffering[];
  /** Active staff of the org, unfiltered. Empty only in preview mode. */
  staff?: PublicStaff[];
  /** serviceId → eligible staff ids; absent means "every staff member". */
  serviceStaffIds?: Record<string, string[]>;
  /** The page's Team section pick (page-request.ts): the service list narrows
      to that person, and they stay chosen through the service step. */
  requestedStaff?: { id: string | null; key: number } | null;
  /** Per-staff page / `?staff=`: no person switch, no "Anyone". */
  lockedStaff?: PublicStaff | null;
  /** Canned data for the admin's live previews: the appointment slots, and
      — when present — what the rental flows need, so a Spaces card can open
      its flow in preview too (spec §8). */
  preview?: { slots: string[]; availability?: RangeAvailability };
  /** Booking-page hand-off (services section / `?service=`): each request
      carries a key so re-picking the same service after "change" still applies. */
  requestedService?: { id: string; key: number } | null;
  /** A Spaces-section card asked for this offering (page-state.tsx). Same
      once-per-key contract as requestedService. */
  requestedOffering?: { id: string; key: number } | null;
  /** False when the hosted page already lists the channel in a Services /
      Spaces section (pickers.ts): that section is the picker, the widget
      waits for its card instead of showing the catalogue a second time. */
  listServices?: boolean;
  listOfferings?: boolean;
  /** False when a Team section on the page is the person picker: the widget
      keeps the choice but shows no switch of its own. */
  listStaff?: boolean;
  /** How free times are shown — the widget template (widget-theme.ts). */
  layout?: SlotLayout;
  /** How a stay is picked — the stays template (spec §8). */
  stayLayout?: StayLayout;
}) {
  const t = useTranslations("public.widget");
  const tu = useTranslations("public.units");
  const intl = INTL_LOCALES[useLocale()];
  // Who can take this service. Declared before the state below because the
  // lazy initialiser for `staffChoice` has to answer the same question for an
  // auto-selected service.
  const eligibleFor = (svc: PublicService) =>
    serviceStaffIds ? staff.filter((s) => (serviceStaffIds[svc.id] ?? []).includes(s.id)) : staff;
  // The solo rule: one eligible person (or a locked one) means no switch, no
  // "with X" anywhere — the widget renders exactly as it did before teams.
  const canChooseStaff = (svc: PublicService) => !lockedStaff && eligibleFor(svc).length > 1;
  // Several eligible people start on "Anyone" — the times load at once and
  // the switch above them is there for a visitor with a preference. With
  // exactly one eligible person we pass that id, not "any", so the RPC does
  // the strict named check rather than auto-assigning.
  const resolveStaff = (svc: PublicService): string => {
    if (lockedStaff) return lockedStaff.id;
    const eligible = eligibleFor(svc);
    return eligible.length === 1 ? eligible[0]!.id : "any";
  };

  // Where the times open for a fresh look at a service: the layout's home
  // window (this week, this month, …) — or, in preview, the window holding
  // the canned slots (they sit far in the future so nothing ever needs
  // refreshing; a window at today would show none).
  const home = (): SlotWindow => {
    const today = todayISO();
    if (!preview) return homeWindow(layout, today);
    const first = firstDayBeyond(preview.slots, homeWindow(layout, today), viewerDay) ?? today;
    return windowAround(layout, first, today);
  };

  // Auto-select only when there is genuinely nothing to choose between —
  // one service AND no rentals (or vice versa below).
  const autoService = services.length === 1 && offerings.length === 0 ? services[0] : null;
  const [service, setService] = React.useState<PublicService | null>(autoService);
  const [staffChoice, setStaffChoice] = React.useState<string | null>(() =>
    lockedStaff ? lockedStaff.id : autoService ? resolveStaff(autoService) : null,
  );
  // The rental flows fetch availability — the admin previews are
  // contractually offline, so they mount in preview only with canned data.
  const rentalPreview = preview?.availability ? { slots: preview.slots, availability: preview.availability } : null;
  const [offering, setOffering] = React.useState<PublicOffering | null>(
    (!preview || rentalPreview) && services.length === 0 && offerings.length === 1 ? offerings[0] : null,
  );
  // Preview mode (settings live preview) has its slots up front — seed them
  // so date navigation never passes through a loading state (which flashed
  // the list away for a frame).
  const [slots, setSlots] = React.useState<string[]>(preview?.slots ?? []);
  const [win, setWin] = React.useState<SlotWindow>(home);
  // False until the visitor pages (or the first look jumped ahead): the
  // fetch for a fresh service/person spans FIRST_LOOK_DAYS and may move
  // the window to the one holding the first free time; after that, one
  // window at a time.
  const [navigated, setNavigated] = React.useState(false);
  const [firstLookEmpty, setFirstLookEmpty] = React.useState(false);
  const [slot, setSlot] = React.useState<string | null>(null);
  const [doneToken, setDoneToken] = React.useState<string | null>(null);
  // Whom the RPC actually assigned — null for solo orgs, so the confirmation
  // stays wordless there.
  const [doneStaffName, setDoneStaffName] = React.useState<string | null>(null);
  // Whether the RPC left it pending (the service requires approval) — the
  // done panel says "Request sent" instead of "Booking confirmed".
  const [donePending, setDonePending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const slotsRegionRef = React.useRef<HTMLDivElement>(null);
  // Each fetch takes a ticket; a response whose ticket is no longer the
  // latest is dropped. Without this the LAST response to arrive wins: a
  // 28-day first look that lands after the 7-day page the visitor paged to
  // would overwrite it and jump them off the page they chose (review of
  // PR #74). use-handle-check.ts's `cancelled` flag is the same idea.
  const requestRef = React.useRef(0);

  // A fresh look: back to the home page, first-look fetch re-armed.
  const restart = () => {
    setSlot(null);
    setWin(home());
    setNavigated(false);
    setFirstLookEmpty(false);
  };

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
      restart();
    }
  }

  // The Team section's pick, once per key: the person becomes the choice, and
  // a service they cannot take steps back to the list rather than showing
  // times nobody can book.
  const [appliedStaffKey, setAppliedStaffKey] = React.useState<number | null>(null);
  if (requestedStaff && requestedStaff.key !== appliedStaffKey && !lockedStaff) {
    setAppliedStaffKey(requestedStaff.key);
    setStaffChoice(requestedStaff.id ?? "any");
    if (service && requestedStaff.id && !staffOffers(serviceStaffIds, service.id, requestedStaff.id)) {
      setService(null);
      setSlot(null);
    } else restart();
  }

  // A layout change (the studio's previews switch it live; on a real page
  // it is fixed) opens the fresh layout on its own home window — same
  // render-time adjust as requestedService above.
  const [appliedLayout, setAppliedLayout] = React.useState(layout);
  if (layout !== appliedLayout) {
    setAppliedLayout(layout);
    restart();
  }

  // Same render-time apply as requestedService above — once per key, never loops.
  const [appliedOfferingKey, setAppliedOfferingKey] = React.useState<number | null>(null);
  if (requestedOffering && requestedOffering.key !== appliedOfferingKey) {
    setAppliedOfferingKey(requestedOffering.key);
    const found = offerings.find((o) => o.id === requestedOffering.id);
    if (found) {
      setOffering(found);
      setService(null);
      setStaffChoice(null);
      setSlot(null);
    }
  }

  // Used by the confirmation step below once a slot is picked (day and time
  // in one formatter so the locale supplies the joiner). TimeSlotGrid needs
  // similar formatting but keeps its own copies — intentionally duplicated,
  // not shared, across the component boundary.
  const whenFmt = new Intl.DateTimeFormat(intl, { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  const loadSlots = React.useCallback(
    (svc: PublicService, w: SlotWindow, staffId: string, firstLook: boolean) => {
      // Preview mode: no server action, no network, and the canned slots are
      // already in state (seeded above) — nothing to load.
      if (preview) return;
      startTransition(async () => {
        const ticket = ++requestRef.current;
        setError(null);
        const days = firstLook ? firstLookDays(w) : w.days;
        const result = await getSlots({ handle, serviceId: svc.id, fromDate: w.from, days, staffId });
        if (ticket !== requestRef.current) return;
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setSlots(result.slots);
        // Only a first look that found nothing earns the four-week wording;
        // a window the visitor navigated to gets the plain "this week" line.
        setFirstLookEmpty(firstLook && result.slots.length === 0);
        if (!firstLook) return;
        // Booked out here? Open on the window holding the first free time —
        // one round trip instead of a "try the next" click per empty page.
        // The jump counts as paging, so the refetch it triggers is one window.
        const target = firstDayBeyond(result.slots, w, viewerDay);
        if (target) {
          setWin(windowAround(layout, target, todayISO()));
          setNavigated(true);
        }
      });
    },
    [handle, preview, layout],
  );

  React.useEffect(() => {
    if (service && staffChoice) loadSlots(service, win, staffChoice, !navigated);
  }, [service, staffChoice, win, navigated, loadSlots]);

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
        setDonePending(result.pending);
      } else {
        setError(result.error);
        if ("slotTaken" in result && result.slotTaken) {
          setSlot(null);
          loadSlots(service, win, staffChoice, false);
        }
      }
    });
  }

  // Rentals are a separate flow end-to-end (date ranges/durations, units,
  // org-local times) — hand the whole widget over once an offering is
  // picked. Hourly offerings (H2) branch to their own flow: RentalBookingFlow
  // is nights/days-only (staySummary calls hhmm(startTime!), which is null
  // for hours) and must never see one.
  // Preview (admin live previews / template thumbnails) never mounts the
  // rental flows — they fetch availability (PR #58's inert rule). A Spaces
  // card click in preview still records the request; the list just stays.
  // `key={offering.id}` is load-bearing: requestedOffering (Spaces card) can
  // swap `offering` while a flow is already mounted, and without the key
  // React would keep the old flow's state (range/unitId/termsAccepted/
  // durationMin) across the swap — the key forces a fresh flow instead.
  if (offering && (!preview || rentalPreview)) {
    // Back to the widget's list — only when it lists something (a page whose
    // Spaces section is the picker re-picks there instead).
    const onOfferingBack =
      services.length + offerings.length > 1 && ((listServices && services.length > 0) || (listOfferings && offerings.length > 1))
        ? () => setOffering(null)
        : null;
    return offering.rangeMode === "hours" ? (
      <HourlyBookingFlow
        key={offering.id}
        handle={handle}
        orgTimeZone={orgTimeZone}
        offering={offering}
        currency={currency}
        onBack={onOfferingBack}
        layout={layout}
        preview={rentalPreview ? { slots: rentalPreview.slots } : undefined}
      />
    ) : (
      <RentalBookingFlow
        key={offering.id}
        handle={handle}
        orgTimeZone={orgTimeZone}
        offering={offering}
        currency={currency}
        onBack={onOfferingBack}
        stayLayout={stayLayout}
        preview={rentalPreview ? { availability: rentalPreview.availability } : undefined}
      />
    );
  }

  if (doneToken)
    return (
      <BookingConfirmed
        token={doneToken}
        // What landed, restated (service and slot are still in state).
        summary={service && slot ? { title: service.name, whenLine: whenFmt.format(new Date(slot)) } : undefined}
        staffName={doneStaffName}
        pending={donePending}
      />
    );

  // Whom this booking is with, or null when there is nothing worth saying —
  // a solo org (or one eligible person) must read exactly as it did before
  // teams existed, so no "with X" line appears at all. Above the times the
  // switch itself says who; the line only repeats it once the switch is gone
  // (the confirmation step) or the person is fixed by the link.
  const chosenStaff = staffChoice && staffChoice !== "any" ? staff.find((s) => s.id === staffChoice) : undefined;
  const withLabel = lockedStaff
    ? lockedStaff.name
    : service && canChooseStaff(service)
      ? (staffChoice === "any" ? t("anyone") : (chosenStaff?.name ?? null))
      : null;
  // What the widget itself lists; a channel the page's own section lists is
  // only ever picked there, so "change" makes sense only while something is
  // listed here to change to.
  const showServices = listServices && services.length > 0;
  // Who before what: a person picked in the page's Team section narrows this
  // list to what they do. The pick itself lives up there, so the widget only
  // follows it.
  const picked = lockedStaff ? null : (requestedStaff?.id ?? null);
  const listedServices = picked ? services.filter((s) => staffOffers(serviceStaffIds, s.id, picked)) : services;
  const showOfferings = listOfferings && offerings.length > 0;
  const deferredServices = !listServices && services.length > 0;
  const deferredOfferings = !listOfferings && offerings.length > 0;
  const prompt = deferredServices ? t("promptServices") : deferredOfferings && !showServices ? t("promptSpaces") : null;
  const canChangeService = services.length + offerings.length > 1 && (showServices || showOfferings);
  const changeService = () => {
    setService(null);
    setStaffChoice(lockedStaff?.id ?? null);
    setSlots(preview?.slots ?? []);
    restart();
  };

  // The picking step's shared chrome, whatever the layout.
  const today = todayISO();
  const header = service ? (
    <p className={cn(STEP_LABEL, "min-w-0")}>
      {service.name}
      {lockedStaff ? (
        // "with X" only when the person is fixed by the link the visitor
        // followed; a pick of their own shows on the switch.
        <span className="text-muted-foreground font-normal">{" "}{t("with", { name: lockedStaff.name })}</span>
      ) : null}{" "}
      {canChangeService ? (
        <button type="button" className={CHANGE_LINK} onClick={changeService}>
          {t("change")}
        </button>
      ) : null}
    </p>
  ) : null;
  // The switch, or — when the page's Team section is the picker — the line
  // that says who these times are for, since nothing else here would.
  const toolbar = !service || !canChooseStaff(service) ? null : listStaff ? (
    <StaffSwitch
      options={eligibleFor(service)}
      value={staffChoice ?? "any"}
      onChange={(id) => {
        setStaffChoice(id);
        restart();
      }}
    />
  ) : chosenStaff ? (
    <p className="text-muted-foreground text-xs">{t("with", { name: chosenStaff.name })}</p>
  ) : null;

  return (
    <div className="@container flex flex-col gap-6">
      {!service ? (
        <div className="flex flex-col gap-6">
          {/* Waiting for the page's own picker: a soft panel, not a bare line,
              so a docked widget column reads as a place rather than a gap. */}
          {prompt ? <p className={cn(PANEL, "text-muted-foreground px-4 py-3 text-sm")}>{prompt}</p> : null}
          {showServices ? (
            <div className="flex flex-col gap-2">
              {/* Headings only when there is something to tell apart. */}
              {showOfferings ? (
                <h2 className="text-muted-foreground text-xs font-medium">{t("appointments")}</h2>
              ) : null}
              <ul className="flex flex-col gap-2">
                {listedServices.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => {
                        flushSync(() => {
                          setService(s);
                          // The page's person stays picked, as long as they
                          // take this service.
                          setStaffChoice(
                            picked && staffOffers(serviceStaffIds, s.id, picked) ? picked : resolveStaff(s),
                          );
                          restart();
                        });
                        // The times always come next now; move focus there so
                        // the service list's disappearance never drops it to
                        // <body>.
                        slotsRegionRef.current?.focus();
                      }}
                      className={ROW}
                    >
                      <span className="min-w-0">
                        <span className="block font-medium">{s.name}</span>
                        {s.description ? (
                          <span className="text-muted-foreground mt-0.5 block text-xs leading-relaxed">
                            {s.description}
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-right text-sm tabular-nums">
                        {s.priceLabel ? <span className="block font-medium">{s.priceLabel}</span> : null}
                        <span className="text-muted-foreground block text-xs">{tu("minutes", { count: s.durationMin })}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {showOfferings ? (
            <div className="flex flex-col gap-2">
              {showServices ? (
                <h2 className="text-muted-foreground text-xs font-medium">{t("spaces")}</h2>
              ) : null}
              <ul className="flex flex-col gap-2">
                {offerings.map((o) => (
                  <li key={o.id}>
                    <button
                      type="button"
                      // Preview without canned rental data: the card renders
                      // so its surface/theme can be judged, but stays inert —
                      // the rental flows fetch availability, and preview never
                      // touches the network.
                      onClick={preview && !rentalPreview ? undefined : () => setOffering(o)}
                      aria-disabled={preview && !rentalPreview ? true : undefined}
                      className={ROW}
                    >
                      <span className="min-w-0">
                        <span className="block font-medium">{o.name}</span>
                        {o.description ? (
                          <span className="text-muted-foreground mt-0.5 block text-xs leading-relaxed">
                            {o.description}
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-right text-sm tabular-nums">
                        {formatOfferingPrice(o, currency, tu) ? <span className="block font-medium">{formatOfferingPrice(o, currency, tu)}</span> : null}
                        {stayHint(o, tu) ? <span className="text-muted-foreground block text-xs">{stayHint(o, tu)}</span> : null}
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
          <SlotPicker
            layout={layout}
            slots={slots}
            window={win}
            today={today}
            pending={pending}
            orgTimeZone={orgTimeZone}
            regionRef={slotsRegionRef}
            headerSlot={header}
            toolbar={toolbar}
            emptyHint={firstLookEmpty ? t("noneInFirstLook") : undefined}
            onNavigate={(next) => {
              setWin(next);
              setNavigated(true);
            }}
            onPick={setSlot}
          />
        </div>
      ) : (
        <form
          // onSubmit rather than action: React resets an action form's fields
          // when the action settles, so a refused booking (rate limit, a slot
          // just taken) would wipe the name and email the visitor typed.
          onSubmit={(e) => {
            e.preventDefault();
            submit(new FormData(e.currentTarget));
          }}
          className="wt-enter flex flex-col gap-4"
        >
          {/* The receipt: what they're committing to, restated at the moment
              of commitment on a soft panel — service, person, time, then
              length and price when the service names one. */}
          <div className={cn(PANEL, "flex items-start justify-between gap-3 px-4 py-3 text-sm")}>
            <div className="min-w-0">
              <p className="font-medium">
                {service.name}
                {/* "with Anna" only when the person is fixed by the link — "with
                    Anyone" would be nonsense — else "· X" for the visitor's own pick. */}
                {withLabel ? <span className="text-muted-foreground font-normal">{lockedStaff ? ` ${t("with", { name: withLabel })}` : ` · ${withLabel}`}</span> : null}
              </p>
              <p className="mt-0.5 tabular-nums">{whenFmt.format(new Date(slot))}</p>
              <p className="text-muted-foreground mt-0.5 text-xs tabular-nums">
                {tu("minutes", { count: service.durationMin })}{service.priceLabel ? ` · ${service.priceLabel}` : ""}
              </p>
            </div>
            <button type="button" className={cn(CHANGE_LINK, "shrink-0")} onClick={() => setSlot(null)}>
              {t("change")}
            </button>
          </div>
          <ClientDetailsFields />
          <Button type="submit" size="lg" className="wt-primary mt-1 w-full" disabled={pending || !!preview}>
            {preview
              ? t("preview")
              : pending
                ? t("sending")
                : service.requiresApproval
                  ? t("requestToBook")
                  : t("confirmBooking")}
          </Button>
        </form>
      )}
      {error ? <p role="alert" className="text-destructive text-sm">{error}</p> : null}
    </div>
  );
}
