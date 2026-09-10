"use client";

import { WidgetTheme } from "@/components/widget-theme";
import { BookingWidget } from "@/features/scheduling/components/booking-widget";
import { resolveLayout, resolveStayLayout } from "@/lib/widget-theme";
import { PREVIEW_AVAILABILITY } from "@/features/rentals/preview-availability";
import type { SectionOf } from "../../schema";
import type { RenderContext } from "../context";
import { CrossLink } from "../cross-link";
import { usePageState } from "../page-state";
import type { Pickers } from "../pickers";
import { H2 } from "../type";

export function BookingSection({ section, ctx, pickers, crossLink }: { section: SectionOf<"booking">; ctx: RenderContext; pickers: Pickers; crossLink: RenderContext["crossLink"] }) {
  const { requested, staffPick } = usePageState();
  const preview = ctx.mode === "preview";
  return (
    <section id="book" className="flex scroll-mt-6 flex-col gap-4">
      {section.title.trim() ? <h2 className={H2}>{section.title}</h2> : null}
      <CrossLink link={crossLink} mode={ctx.mode} />
      <div>
        {/* The widget's own surface: transparent unless the org set a background
            override — exactly the wrapper /book used before the builder. The page
            above carries the same theme (always transparent) for the other sections. */}
        <WidgetTheme config={ctx.theme} accentColor={ctx.branding.accentColor} transparent={!ctx.theme.background}>
          <BookingWidget
            handle={preview ? "preview" : ctx.org.handle}
            orgTimeZone={ctx.org.timeZone}
            currency={ctx.org.currency}
            clientContact={ctx.org.clientContact}
            layout={resolveLayout(ctx.theme)}
            stayLayout={resolveStayLayout(ctx.theme)}
            services={ctx.services}
            // Preview mode: canned slots, never a network call. Rentals DO
            // render (the builder hands in the org's preview catalogue) — the
            // widget keeps their cards inert in preview.
            offerings={ctx.offerings}
            // One picker per page (pickers.ts): a Services / Spaces section on
            // the page lists the channel; the widget then only takes the pick.
            listServices={!pickers.services}
            listOfferings={!pickers.spaces}
            // A Team section on the page is the person picker; the widget
            // then only follows it.
            listStaff={!pickers.staff}
            // The roster rides along in preview too: the person switch is
            // most of what a client sees after picking a service, and picking
            // one here loads canned slots rather than fetching.
            staff={ctx.staff}
            serviceStaffIds={ctx.serviceStaffIds}
            lockedStaff={preview ? null : ctx.lockedStaff}
            // Who the Team section picked, if anyone (staff.tsx).
            requestedStaff={staffPick}
            requestedService={requested?.kind === "service" ? requested : null}
            requestedOffering={requested?.kind === "offering" ? requested : null}
            // Canned slots and availability: in preview the rental flows open
            // too (spec §8), so the stays templates can be judged live.
            preview={preview && ctx.previewSlots ? { slots: ctx.previewSlots, availability: PREVIEW_AVAILABILITY } : undefined}
          />
        </WidgetTheme>
      </div>
    </section>
  );
}
