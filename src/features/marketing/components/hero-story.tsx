import { HugeiconsIcon } from "@hugeicons/react";
import { House01Icon } from "@hugeicons/core-free-icons";

/* The story over the week (globals.css "Hero story"): one 10s CSS loop, no
   JS. A cursor comes in and drags Wednesday 15:00–17:00 (the grid's own
   gesture), the booking lands as the calendar's pending ghost (dashed,
   translucent), then the deposit notice arrives and the block turns solid.
   Geometry is % of the screenshot (2880×1800: the Wed column starts 44.5%
   in and is 10.25% wide; hours are 6.8% tall from 18.8%); the block's type
   is in cqw so it scales with the screenshot's own. Decorative: the
   screenshot's alt tells the reader what the admin is. */
export function HeroStory() {
  return (
    <div aria-hidden="true" className="hs pointer-events-none absolute inset-0">
      <div className="hs-select" />
      <div className="hs-block">
        <span className="font-medium">
          <HugeiconsIcon icon={House01Icon} size={12} className="hs-block-icon inline-block shrink-0" aria-hidden />{" "}
          Room A
        </span>
        <span className="hs-block-muted">Anna Kowalska</span>
        <span className="hs-block-muted">15:00–17:00</span>
      </div>
      <svg className="hs-cursor" viewBox="0 0 20 20" fill="none">
        <path d="M3 2.5l13.2 9.6-6.1.9 3.4 6.1-2.3 1.2-3.3-6-4.2 4.4z" fill="#252228" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
      <div className="hs-notice">
        <span className="hs-notice-dot">
          <svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M2.5 6.3l2.3 2.3 4.7-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span>
          <strong className="block font-medium">Deposit paid · 140 zł</strong>
          <span className="hs-notice-muted block">Anna Kowalska · Room A, Wed 7 Oct</span>
        </span>
      </div>
    </div>
  );
}
