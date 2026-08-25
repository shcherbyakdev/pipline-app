import { BellRing, Check, Lock, Mail } from "lucide-react";
import type { FeatureVisual } from "@/features/marketing/site";
import { SITE } from "@/features/marketing/site";
import { cn } from "@/lib/utils";

/* Fragments of the product for the Features section — small white
   "windows" anchored in the panel and cut off by its edge. The two wide
   panels (page, manage) add a second window at lg+; narrower ones show one.
   Static fixtures, decorative (the panel is aria-hidden). */

const SLUG = SITE.name.toLowerCase();
const DOW = ["M", "T", "W", "T", "F", "S", "S"];
const OPEN = new Set([3, 4, 5, 10, 11, 12, 17, 18, 19]);

function Window({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "bg-card ring-border absolute left-1/2 w-[min(270px,calc(100%-2rem))] -translate-x-1/2 rounded-xl shadow-[0_1px_2px_rgb(26_34_56/0.04),0_12px_32px_-16px_rgb(26_34_56/0.18)] ring-1",
        className,
      )}
    >
      {children}
    </div>
  );
}

function Avatar({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <span
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
        muted ? "bg-secondary text-muted-foreground" : "bg-highlight/12 text-highlight",
      )}
    >
      {children}
    </span>
  );
}

/* Hosted page: the address, the month on a desktop, the same page on a phone. */
function PageMock() {
  return (
    <>
      <div className="bg-card/70 ring-border text-muted-foreground absolute top-5 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[10px] ring-1 lg:left-10 lg:translate-x-0">
        <Lock className="size-2.5" />
        {SLUG}.co/anna-studio
      </div>

      <Window className="top-14 hidden w-[300px] p-4 lg:left-10 lg:block lg:translate-x-0">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-medium">October</span>
          <span className="text-muted-foreground text-[11px]">‹ ›</span>
        </div>
        <div className="text-muted-foreground mt-2 grid grid-cols-7 text-center text-[9px]">
          {DOW.map((d, i) => (
            <span key={i}>{d}</span>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {Array.from({ length: 21 }, (_, i) => i + 1).map((d) => (
            <span
              key={d}
              className={cn(
                "flex h-6 items-center justify-center rounded-md text-[10px]",
                OPEN.has(d) ? "bg-card ring-border font-medium ring-1" : "text-muted-foreground/60",
                d === 11 && "bg-highlight text-primary-foreground ring-0",
              )}
            >
              {d}
            </span>
          ))}
        </div>
      </Window>

      <div className="bg-foreground absolute top-14 left-1/2 w-[210px] -translate-x-1/2 rounded-[1.75rem] p-1.5 shadow-[0_24px_48px_-20px_rgb(26_34_56/0.45)] lg:right-10 lg:left-auto lg:translate-x-0">
        <div className="bg-card rounded-[1.4rem] px-4 pt-3 pb-4">
          <div className="bg-foreground/80 mx-auto mb-4 h-1 w-10 rounded-full" />
          <div className="flex items-center gap-2.5">
            <span className="bg-highlight text-primary-foreground flex size-8 items-center justify-center rounded-full text-xs font-medium">A</span>
            <span>
              <span className="block text-[13px] leading-tight font-medium">Anna Studio</span>
              <span className="text-muted-foreground block text-[11px]">Book a session</span>
            </span>
          </div>
          <ul className="mt-3 space-y-1.5">
            <li className="ring-highlight flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs ring-1">
              <span>Consultation</span>
              <span className="text-muted-foreground">30 min</span>
            </li>
            <li className="ring-border flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs ring-1">
              <span>Follow-up</span>
              <span className="text-muted-foreground">15 min</span>
            </li>
          </ul>
          <div className="mt-3 grid grid-cols-5 gap-1">
            {["3", "4", "5", "6", "7"].map((d, i) => (
              <span
                key={d}
                className={cn(
                  "flex h-7 items-center justify-center rounded-md text-[11px]",
                  i === 2 ? "bg-highlight text-primary-foreground font-medium" : "bg-secondary",
                )}
              >
                {d}
              </span>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

/* Spaces: a room booked by the hour — the card, and the window picked on it.
   The photo is a placeholder gradient (the real page shows the provider's
   photo). */
const HOURS = ["9", "10", "11", "12", "13", "14", "15", "16", "17"];
function SpacesMock() {
  return (
    <Window className="top-8 p-3.5 lg:w-[300px]">
      <div className="flex gap-3">
        <span className="size-14 shrink-0 rounded-lg bg-[linear-gradient(135deg,oklch(0.86_0.06_268),oklch(0.72_0.11_300))]" />
        <span className="min-w-0">
          <span className="block text-[13px] leading-tight font-medium">Studio A</span>
          <span className="text-muted-foreground mt-0.5 block text-[11px]">Rehearsal room · 2 units</span>
          <span className="text-muted-foreground mt-1.5 block font-mono text-[10px] tracking-wider uppercase">by the hour · 1–4 h</span>
        </span>
      </div>
      <div className="mt-3 flex gap-1">
        {HOURS.map((h, i) => (
          <span
            key={h}
            className={cn(
              "h-7 flex-1 rounded-md text-center text-[10px] leading-7",
              i >= 4 && i <= 5 ? "bg-highlight text-primary-foreground font-medium" : "bg-secondary text-muted-foreground",
            )}
          >
            {h}
          </span>
        ))}
      </div>
      <div className="mt-2.5 flex items-center justify-between text-[11px]">
        <span className="font-medium">13:00 – 15:00</span>
        <span className="text-muted-foreground font-mono text-[10px]">2 h · 1 of 2 units free</span>
      </div>
    </Window>
  );
}

/* Embed: the one snippet, with the parts you'd actually change lit. */
function EmbedMock() {
  const lines: Array<[string, string, string]> = [
    ["<div ", `id="${SLUG}-widget"`, "></div>"],
    ["<script ", `src="https://${SLUG}.co/embed.js"`, ""],
    ["  ", 'data-handle="anna-studio"', " async></script>"],
  ];
  return (
    <Window className="top-8 w-[min(330px,calc(100%-2rem))] overflow-hidden">
      <div className="border-border flex items-center gap-1.5 border-b px-3 py-2">
        <span className="bg-border size-2 rounded-full" />
        <span className="bg-border size-2 rounded-full" />
        <span className="bg-border size-2 rounded-full" />
        <span className="text-muted-foreground ml-1.5 font-mono text-[10px]">index.html</span>
      </div>
      <pre className="p-3 font-mono text-[10.5px] leading-5 break-all whitespace-pre-wrap">
        {lines.map((l, i) => (
          <div key={i} className="flex">
            <span className="text-muted-foreground/50 w-4 shrink-0 select-none">{i + 1}</span>
            <span>
              <span className="text-muted-foreground">{l[0]}</span>
              <span className="text-highlight">{l[1]}</span>
              <span className="text-muted-foreground">{l[2]}</span>
            </span>
          </div>
        ))}
      </pre>
    </Window>
  );
}

/* Slot guard: two people, one 10:30. The first wins; the second is offered
   the next opening instead of a silent double booking. */
function SlotGuardMock() {
  return (
    <Window className="top-8 p-3.5">
      <p className="text-muted-foreground font-mono text-[10px] tracking-[0.14em] uppercase">Fri 21 · 10:30</p>
      <ul className="mt-2.5 space-y-2">
        <li className="bg-highlight/8 flex items-center justify-between rounded-lg px-2.5 py-2 text-xs">
          <span className="flex items-center gap-2">
            <Avatar>MN</Avatar>Mia Novak
          </span>
          <span className="text-highlight flex items-center gap-1 font-medium">
            <Check className="size-3" strokeWidth={3} />
            Booked
          </span>
        </li>
        <li className="ring-border flex items-center justify-between rounded-lg px-2.5 py-2 text-xs ring-1">
          <span className="flex items-center gap-2">
            <Avatar muted>TR</Avatar>Tom Reyes
          </span>
          <span className="text-muted-foreground">
            Just taken → <span className="text-foreground font-medium">11:00</span>
          </span>
        </li>
      </ul>
    </Window>
  );
}

/* Manage: the confirmation email's two buttons, and (wide) the reschedule
   step they lead to — no account, just the link. */
function ManageMock() {
  const times = ["Mon 24 · 9:00", "Mon 24 · 11:00", "Tue 25 · 14:30", "Wed 26 · 10:00"];
  return (
    <>
      <Window className="top-8 p-4 lg:left-10 lg:translate-x-0">
        <div className="flex items-center gap-2.5">
          <span className="bg-highlight/12 text-highlight flex size-7 shrink-0 items-center justify-center rounded-full">
            <Mail className="size-3.5" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] leading-tight font-medium">Your booking is confirmed</span>
            <span className="text-muted-foreground block text-[11px]">Consultation · Fri 21 Aug, 15:30</span>
          </span>
        </div>
        <div className="mt-3.5 flex gap-2">
          <span className="bg-primary text-primary-foreground rounded-full px-3 py-1.5 text-[11px] font-medium">Reschedule</span>
          <span className="ring-input rounded-full px-3 py-1.5 text-[11px] font-medium ring-1 ring-inset">Cancel</span>
        </div>
        <p className="text-muted-foreground mt-3 text-[11px]">No account needed — this link is yours.</p>
      </Window>
      <Window className="top-16 hidden w-[240px] p-3.5 lg:right-10 lg:left-auto lg:block lg:translate-x-0">
        <p className="text-muted-foreground font-mono text-[10px] tracking-[0.14em] uppercase">Pick another time</p>
        <div className="mt-2.5 grid grid-cols-2 gap-1.5">
          {times.map((t, i) => (
            <span
              key={t}
              className={cn(
                "rounded-lg px-2 py-1.5 text-center text-[11px] ring-1",
                i === 2 ? "bg-highlight text-primary-foreground ring-highlight font-medium" : "ring-border",
              )}
            >
              {t}
            </span>
          ))}
        </div>
        <span className="bg-primary text-primary-foreground mt-3 block rounded-full py-1.5 text-center text-[11px] font-medium">Confirm new time</span>
      </Window>
    </>
  );
}

/* Reminder: a notification, with the confirmation it followed tucked behind. */
function ReminderMock() {
  return (
    <>
      <Window className="top-6 scale-95 p-3.5 opacity-50 lg:w-[320px]">
        <div className="flex items-center gap-2.5">
          <span className="bg-secondary text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-full">
            <Mail className="size-3.5" />
          </span>
          <span className="text-muted-foreground text-[12px]">Confirmation sent · 3 days ago</span>
        </div>
      </Window>
      <Window className="top-14 p-3.5 lg:w-[320px]">
        <div className="flex items-start gap-2.5">
          <span className="bg-highlight/12 text-highlight flex size-7 shrink-0 items-center justify-center rounded-full">
            <BellRing className="size-3.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-medium">Reminder</span>
              <span className="text-muted-foreground font-mono text-[10px]">24 h before</span>
            </span>
            <span className="text-muted-foreground mt-0.5 block text-[12px] leading-snug">Consultation with Anna Studio tomorrow at 10:30.</span>
          </span>
        </div>
      </Window>
    </>
  );
}

/* Brand: the colour picker and what it changes. The swatches are the kind of
   colours a provider picks, not tokens — hence literal values. */
const SWATCHES = ["oklch(0.53 0.23 268)", "oklch(0.62 0.17 150)", "oklch(0.7 0.18 50)", "oklch(0.62 0.22 350)", "oklch(0.22 0.03 262)"];
function BrandMock() {
  return (
    <Window className="top-8 p-4 lg:w-[320px]">
      <p className="text-muted-foreground font-mono text-[10px] tracking-[0.14em] uppercase">Brand colour</p>
      <div className="mt-2.5 flex items-center gap-2">
        {SWATCHES.map((c, i) => (
          <span
            key={c}
            className={cn("size-6 rounded-full", i === 0 && "ring-highlight ring-offset-card ring-2 ring-offset-2")}
            style={{ background: c }}
          />
        ))}
      </div>
      <div className="border-border mt-4 flex items-center justify-between border-t pt-3">
        <span className="flex items-center gap-2">
          <span className="bg-highlight text-primary-foreground flex size-7 items-center justify-center rounded-lg text-[11px] font-semibold">A</span>
          <span className="text-[13px] font-medium">Anna Studio</span>
        </span>
        <span className="bg-highlight text-primary-foreground rounded-full px-3 py-1.5 text-[11px] font-medium">Book now</span>
      </div>
    </Window>
  );
}

export function FeatureMock({ kind }: { kind: FeatureVisual }) {
  switch (kind) {
    case "page":
      return <PageMock />;
    case "spaces":
      return <SpacesMock />;
    case "embed":
      return <EmbedMock />;
    case "slot-guard":
      return <SlotGuardMock />;
    case "manage":
      return <ManageMock />;
    case "reminder":
      return <ReminderMock />;
    case "brand":
      return <BrandMock />;
  }
}
