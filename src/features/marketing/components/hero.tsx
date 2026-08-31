"use client";

import * as React from "react";
import { Check, Clock, Moon, Users } from "lucide-react";
import { SITE } from "@/features/marketing/site";
import { ClaimBar } from "./claim-bar";
import { BookingWidget, usePrefersReducedMotion, type WidgetMode } from "./booking-widget";

/* The first viewport: a centred compact hero — a row of product fragments
   (a time slot, the chosen day, the confirmation, a stay's length: the
   product's own vocabulary as ornament), a two-line display headline, the
   sub, the claim bar as the one action, three check-marked truths — then
   the product at real size on a soft grey stage. No tabs: the card itself
   alternates between appointments and spaces on its own, two client
   scenarios per channel, entering from the side it comes from, so both
   channels get equal time without asking the visitor to do anything.
   Everything enters on one short stagger. */

type View = { mode: WidgetMode; from: "none" | "left" | "right" };

/* One die-cut sticker: the same lucide glyph stacked twice in a grid cell.
   The under-copy is filled and fat-stroked white (the die-cut contour), the
   top copy is the coloured glyph. Decoration only. */
function Sticker({ icon: Icon, className }: { icon: typeof Clock; className?: string }) {
  return (
    <span className="frag grid size-12 place-items-center [filter:drop-shadow(0_1px_2px_rgb(28_28_26_/_0.08))_drop-shadow(0_5px_10px_rgb(28_28_26_/_0.14))]">
      <Icon className="size-8 overflow-visible text-white [grid-area:1/1]" fill="white" strokeWidth={7} />
      <Icon className={`size-8 overflow-visible [grid-area:1/1] ${className ?? ""}`} strokeWidth={2.75} />
    </span>
  );
}

/* Two scenarios (2 x NEXT_AT in booking-widget) per channel, then flip. */
const MODE_MS = 17400;

export function Hero({ host }: { host: string }) {
  const [handle, setHandle] = React.useState("");
  const [view, setView] = React.useState<View>({ mode: "appointments", from: "none" });
  const reduced = usePrefersReducedMotion();
  const mode = view.mode;
  const [line1, line2] = SITE.headline;

  /* The channel flip. Under reduced motion the card parks on appointments
     (its own loop is also parked), so nothing moves on its own. */
  React.useEffect(() => {
    if (reduced) return;
    const id = window.setInterval(() => {
      setView((v) =>
        v.mode === "appointments" ? { mode: "spaces", from: "right" } : { mode: "appointments", from: "left" },
      );
    }, MODE_MS);
    return () => window.clearInterval(id);
  }, [reduced]);

  return (
    <section aria-labelledby="hero-heading" className="relative overflow-x-clip">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center px-5 pt-12 text-center sm:px-8 lg:pt-14">
        {/* The four kinds as die-cut stickers: each glyph drawn twice — a fat
            white filled copy underneath forms the sticker's contour (the svg
            is overflow-visible so the stroke isn't clipped), the kind-coloured
            copy sits on top, and a drop-shadow follows the combined
            silhouette. The check takes the disc-badge form instead, like a
            verify badge. They enter on a stagger and then take a quiet story
            beat in sequence (the .frag rules in globals.css). */}
        <div aria-hidden="true" className="flex flex-wrap items-center justify-center gap-3.5">
          <Sticker icon={Clock} className="text-kind-time" />
          <Sticker icon={Users} className="text-kind-class" />
          <span className="frag grid size-12 place-items-center [filter:drop-shadow(0_1px_2px_rgb(28_28_26_/_0.08))_drop-shadow(0_5px_10px_rgb(28_28_26_/_0.14))]">
            <span className="bg-kind-space text-on-kind grid size-9 place-items-center rounded-full ring-4 ring-white">
              <Check className="size-5" strokeWidth={3.5} />
            </span>
          </span>
          <Sticker icon={Moon} className="text-kind-stay" />
        </div>

        <h1
          id="hero-heading"
          className="text-foreground font-display mt-6 text-[32px] leading-[1.04] font-medium tracking-[-0.03em] text-balance min-[430px]:text-[36px] sm:max-w-[17ch] sm:text-[46px] lg:text-[54px]"
        >
          <span className="animate-fade-up block">{line1}</span>
          <span className="animate-fade-up block [animation-delay:60ms]">{line2}</span>
        </h1>

        <p className="animate-fade-up text-muted-foreground mt-4 max-w-[34rem] text-[17px] leading-relaxed text-balance [animation-delay:120ms]">
          {SITE.subheadline}
        </p>

        <ClaimBar
          handle={handle}
          onHandleChange={setHandle}
          host={host}
          idleNote={SITE.heroNote}
          size="lg"
          className="animate-fade-up mt-7 w-full max-w-[520px] text-left [animation-delay:180ms]"
        />

        <ul
          aria-label="What the page guarantees"
          className="animate-fade-up text-muted-foreground mt-5 flex flex-wrap justify-center gap-x-[18px] gap-y-2 text-[14px] [animation-delay:240ms]"
        >
          {SITE.truths.map((t) => (
            <li key={t} className="flex items-center gap-[7px] whitespace-nowrap">
              <Check className="text-kind-space-text size-4" strokeWidth={3} aria-hidden="true" />
              {t}
            </li>
          ))}
        </ul>
      </div>

      {/* the stage */}
      <div className="animate-fade-up relative mx-auto mt-12 w-full max-w-6xl px-5 [animation-delay:320ms] sm:px-8 lg:mt-14">
        <div
          id="hero-preview"
          role="img"
          aria-label={
            mode === "spaces"
              ? "An example booking page for spaces: a client picks a studio, a day and a window of hours, and is booked; the confirmation and the reminder follow."
              : "An example booking page for appointments: a client picks a service, a day and a time, and is booked; the confirmation and the reminder follow."
          }
          className="stage-wash relative rounded-[28px] px-4 py-5 sm:px-8 sm:py-8 lg:px-12 lg:py-10"
        >
          <BookingWidget handle={handle} host={host} mode={mode} enterFrom={view.from === "none" ? null : view.from} />
        </div>
      </div>
    </section>
  );
}
