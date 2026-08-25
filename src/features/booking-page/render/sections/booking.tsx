"use client";

import { WidgetTheme } from "@/components/widget-theme";
import { BookingWidget } from "@/features/scheduling/components/booking-widget";
import type { SectionOf } from "../../schema";
import type { RenderContext } from "../context";
import { usePageState } from "../page-state";

export function BookingSection({ section, ctx }: { section: SectionOf<"booking">; ctx: RenderContext }) {
  const { requested } = usePageState();
  const preview = ctx.mode === "preview";
  return (
    <section id="book" className="flex scroll-mt-6 flex-col gap-3">
      {section.title.trim() ? <h2 className="text-xl font-semibold tracking-tight">{section.title}</h2> : null}
      {/* The widget's own surface: transparent unless the org set a background
          override — exactly the wrapper /book used before the builder. The page
          above carries the same theme (always transparent) for the other sections. */}
      <WidgetTheme config={ctx.theme} accentColor={ctx.branding.accentColor} transparent={!ctx.theme.background}>
        <BookingWidget
          handle={preview ? "preview" : ctx.org.handle}
          orgTimeZone={ctx.org.timeZone}
          currency={ctx.org.currency}
          services={ctx.services}
          // Preview mode stays exactly what the old studio rendered: no staff
          // step, no rentals, canned slots, never a network call.
          offerings={preview ? [] : ctx.offerings}
          staff={preview ? [] : ctx.staff}
          serviceStaffIds={preview ? undefined : ctx.serviceStaffIds}
          lockedStaff={preview ? null : ctx.lockedStaff}
          requestedService={requested}
          preview={preview && ctx.previewSlots ? { slots: ctx.previewSlots } : undefined}
        />
      </WidgetTheme>
    </section>
  );
}
