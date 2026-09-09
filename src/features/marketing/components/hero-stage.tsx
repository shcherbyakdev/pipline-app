import Image from "next/image";
import { Check } from "lucide-react";
import { SITE } from "@/features/marketing/site";
import { cn } from "@/lib/utils";
import { Record } from "./money";
import adminWeek from "../images/admin-week.png";
import publicPhone from "../images/public-phone.png";

/* The hero's product scene (incident.io-referenced, 2026-09-09): one soft
   stage that runs the ground into the brand's own tint, holding the
   product in layers: the studio's week in the admin as a browser window at
   the back, the hosted page on a phone in front on the left, the booking's
   money record floating in front on the right, the embed snippet as a
   small code window at the back right, and one status pill. Every layer
   is real: two screenshots (scripts/landing-shots.mjs), the money-record
   component, the snippet the app hands out. Layers enter on a stagger
   (`.st-in`, globals.css), then drift apart by depth as the page scrolls
   (scroll-driven, CSS only, ignored where unsupported); a few brand dots
   drift on their own. Decorative below the two images' alt text. */

/* Fixed dot positions and timings, so the drift is the same on every
   visit (no random layout on the server). */
const DOTS = [
  { x: 6, y: 18, s: 6, d: 0 },
  { x: 14, y: 78, s: 4, d: -7 },
  { x: 30, y: 8, s: 5, d: -3 },
  { x: 58, y: 6, s: 4, d: -11 },
  { x: 86, y: 14, s: 6, d: -5 },
  { x: 94, y: 62, s: 5, d: -9 },
  { x: 72, y: 90, s: 4, d: -2 },
  { x: 44, y: 94, s: 5, d: -13 },
];

export function HeroStage({ host }: { host: string }) {
  return (
    <div className="stage-wash relative h-[380px] overflow-hidden rounded-[24px] sm:h-[560px] sm:rounded-[32px] lg:h-[660px]">
      {DOTS.map((d, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="st-dot bg-brand absolute rounded-full opacity-60"
          style={{ left: `${d.x}%`, top: `${d.y}%`, width: d.s, height: d.s, animationDelay: `${d.d}s` }}
        />
      ))}

      {/* back: the admin, in a browser window, cropped by the stage's floor */}
      {/* centred by left + width, not translate: the entrance animates
          `transform`, which would override a translate utility */}
      <div className="st-in st-back absolute top-7 left-[4%] w-[92%] sm:top-12 sm:left-[11%] sm:w-[78%] lg:top-14 [animation-delay:200ms]">
        <div className="bg-card ring-border overflow-hidden rounded-t-[14px] shadow-[var(--shadow-card)] ring-1 sm:rounded-t-[18px]">
          <div className="border-border flex h-9 items-center border-b px-3.5">
            <span className="flex gap-1.5" aria-hidden="true">
              <span className="bg-border size-2.5 rounded-full" />
              <span className="bg-border size-2.5 rounded-full" />
              <span className="bg-border size-2.5 rounded-full" />
            </span>
            <span className="bg-secondary text-subtle mx-auto rounded-md px-3 py-1 font-mono text-[11px]">{host}/bookings</span>
          </div>
          <Image
            src={adminWeek}
            alt={`The ${SITE.name} admin: one studio's week of bookings across Room A, Room B, the make-up room and the whole studio.`}
            priority
            sizes="(min-width: 1152px) 900px, 80vw"
            className="h-auto w-full"
          />
        </div>
      </div>

      {/* back right: the embed snippet, a small code window */}
      <div className="st-in st-mid dark bg-card text-card-foreground ring-border absolute top-[7%] right-[1%] hidden w-[300px] rounded-[14px] p-4 shadow-[var(--shadow-card)] ring-1 md:block [animation-delay:420ms]" aria-hidden="true">
        <div className="text-subtle flex items-center justify-between text-[11px] font-medium">
          <span>Website embed</span>
          <span className="font-mono">2 lines</span>
        </div>
        <pre className="text-muted-foreground mt-3 overflow-hidden font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
          <code>
            {"<iframe src=\"https://"}
            <span className="text-brand-text">{host}</span>
            {"/embed/studio-halo\"\n  style=\"width:100%;border:0\"></iframe>\n<script src=\"https://"}
            <span className="text-brand-text">{host}</span>
            {"/embed.js\" async></script>"}
          </code>
        </pre>
      </div>

      {/* front left: the hosted page on a phone */}
      <div className="st-in st-front absolute bottom-[-18%] left-[4%] w-[40%] sm:bottom-[-10%] sm:left-[5%] sm:w-[200px] lg:w-[228px] [animation-delay:560ms]">
        <div className="bg-foreground overflow-hidden rounded-[26px] p-[6px] shadow-[var(--shadow-lift)] sm:rounded-[34px] sm:p-2">
          <div className="bg-card overflow-hidden rounded-[20px] sm:rounded-[26px]">
            <Image
              src={publicPhone}
              alt="The studio's public booking page on a phone: Room A for four hours, the month with open days, the free windows on a Tuesday."
              sizes="(min-width: 1024px) 228px, (min-width: 640px) 200px, 34vw"
              className="h-auto w-full"
              style={{ aspectRatio: "390 / 640", objectFit: "cover", objectPosition: "top" }}
            />
          </div>
        </div>
      </div>

      {/* the pill: what just happened on the phone */}
      <div className="st-in st-front bg-card text-foreground ring-border absolute bottom-[34%] left-[38%] flex items-center gap-2 rounded-full py-1.5 pr-3.5 pl-1.5 text-[13px] font-medium shadow-[var(--shadow-lift)] ring-1 sm:bottom-[24%] sm:left-[22%] lg:left-[21%] [animation-delay:1200ms]" aria-hidden="true">
        <span className="bg-kind-space-soft text-kind-space-text flex size-6 items-center justify-center rounded-full">
          <Check className="size-3.5" strokeWidth={3} />
        </span>
        Deposit paid, 228 zł
      </div>

      {/* front right: the money record, settled */}
      <div className={cn("st-in st-front absolute right-[3%] bottom-[-6%] hidden w-[340px] sm:block lg:right-[4%] lg:bottom-[3%] lg:w-[380px] [animation-delay:760ms]")} aria-hidden="true">
        <Record beat={6} />
      </div>
    </div>
  );
}
