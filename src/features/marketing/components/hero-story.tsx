import { HugeiconsIcon } from "@hugeicons/react";
import { House01Icon } from "@hugeicons/core-free-icons";

/* The story across the phone and the week (globals.css "Hero story"): one
   19s CSS loop, no JS, four beats of one booking. A client taps 15:00 on
   the phone's Wednesday; the chip lifts off and flies into the week,
   landing as the calendar's pending ghost (dashed, translucent) with the
   price it worked out; the deposit notice arrives and the block turns
   solid; the studio's cursor grabs the block and moves it to Thursday
   11:00; the session runs half an hour over and the charge is added.
   Geometry is % of the screenshot (2880×1800: the Wed column starts 44.5%
   in and is 10.25% wide, Thu one column right; hours are 6.8% tall from
   18.8%) and, for the chip, the phone's own frame (public-phone.png,
   390×624 shown: the 15:00 chip sits 65.2% in, 77.9% down); the block's
   type is in cqw so it scales with the screenshot's own. Every notice
   shares one keyframe and takes its turn by animation-delay. Decorative:
   the images' alts tell the reader what they are. */
export function HeroStory() {
  return (
    <div aria-hidden="true" className="hs pointer-events-none absolute inset-0">
      <span className="hs-tap" />
      <span className="hs-fly">15:00</span>
      <span className="hs-tag">2 h · 280 zł</span>
      <div className="hs-block">
        <span className="font-medium">
          <HugeiconsIcon icon={House01Icon} size={12} className="hs-block-icon inline-block shrink-0" aria-hidden />{" "}
          Room A
        </span>
        <span className="hs-block-muted">Anna Kowalska</span>
        <span className="hs-time hs-block-muted">
          <span className="hs-time-was">15:00–17:00</span>
          <span className="hs-time-now">11:00–13:00</span>
        </span>
        <span className="hs-tail">+30 min</span>
      </div>
      <svg className="hs-cursor" viewBox="0 0 20 20" fill="none">
        <path d="M3 2.5l13.2 9.6-6.1.9 3.4 6.1-2.3 1.2-3.3-6-4.2 4.4z" fill="#252228" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>

      <Notice at="pay" title="Deposit paid · 140 zł" body="Anna Kowalska · Room A, Wed 7 Oct">
        <path d="M2.5 6.3l2.3 2.3 4.7-5" />
      </Notice>
      <Notice at="move" title="Moved to Thu 8 Oct" body="Anna Kowalska · Room A, 11:00–13:00">
        <path d="M2 6h8M7 3l3 3-3 3" />
      </Notice>
      <Notice at="over" title="30 min over · 70 zł added" body="Anna Kowalska · Room A, Thu 8 Oct">
        <path d="M6 3.2V6l1.8 1.4" />
        <circle cx="6" cy="6" r="4.4" />
      </Notice>
    </div>
  );
}

function Notice({ at, title, body, children }: { at: "pay" | "move" | "over"; title: string; body: string; children: React.ReactNode }) {
  return (
    <div className={`hs-notice hs-notice-${at}`}>
      <span className="hs-notice-dot">
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {children}
        </svg>
      </span>
      <span>
        <strong className="block font-medium">{title}</strong>
        <span className="hs-notice-muted block">{body}</span>
      </span>
    </div>
  );
}
