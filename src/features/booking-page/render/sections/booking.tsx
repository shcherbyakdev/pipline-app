"use client";

import { WidgetTheme } from "@/components/widget-theme";
import { BookingWidget } from "@/features/scheduling/components/booking-widget";
import { bookingChannel, type SectionOf } from "../../schema";
import type { RenderContext } from "../context";
import { usePageState } from "../page-state";
import { bookingAnchor, type Pickers } from "../pickers";

export function BookingSection({ section, ctx, pickers }: { section: SectionOf<"booking">; ctx: RenderContext; pickers: Pickers }) {
  const { requested } = usePageState();
  const preview = ctx.mode === "preview";
  // A per-channel widget sees only its channel; the combined one sees both.
  const channel = bookingChannel(section);
  return (
    <section id={bookingAnchor(channel)} className="flex scroll-mt-6 flex-col gap-3">
      {section.title.trim() ? <h2 className="text-xl font-semibold tracking-tight">{section.title}</h2> : null}
      {/* The widget's own surface: transparent unless the org set a background
          override — exactly the wrapper /book used before the builder. The page
          above carries the same theme (always transparent) for the other sections. */}
      <WidgetTheme config={ctx.theme} accentColor={ctx.branding.accentColor} transparent={!ctx.theme.background}>
        <BookingWidget
          handle={preview ? "preview" : ctx.org.handle}
          orgTimeZone={ctx.org.timeZone}
          currency={ctx.org.currency}
          services={channel === "spaces" ? [] : ctx.services}
          // Preview mode: no staff step, canned slots, never a network call.
          // Rentals DO render (the builder hands in the org's preview
          // catalogue) — the widget keeps their cards inert in preview.
          offerings={channel === "appointments" ? [] : ctx.offerings}
          // One picker per page (pickers.ts): a Services / Spaces section on
          // the page lists the channel; the widget then only takes the pick.
          listServices={!pickers.services}
          listOfferings={!pickers.spaces}
          staff={preview ? [] : ctx.staff}
          serviceStaffIds={preview ? undefined : ctx.serviceStaffIds}
          lockedStaff={preview ? null : ctx.lockedStaff}
          requestedService={requested?.kind === "service" ? requested : null}
          requestedOffering={requested?.kind === "offering" ? requested : null}
          preview={preview && ctx.previewSlots ? { slots: ctx.previewSlots } : undefined}
        />
      </WidgetTheme>
    </section>
  );
}
