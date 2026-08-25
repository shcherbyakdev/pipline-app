import { BellRing, Check, Lock, Mail } from "lucide-react";
import type { FeatureVisual } from "@/features/marketing/site";
import { SITE } from "@/features/marketing/site";
import { cn } from "@/lib/utils";

/* Fragments of the product for the Features section — one small white
   "window" per feature, anchored near the top of its panel and cut off by
   the panel's edge. Static fixtures, decorative (the panel is aria-hidden). */

const SLUG = SITE.name.toLowerCase();

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

/* Hosted page: the address, then the top of the page itself. */
function PageMock() {
  const days = ["3", "4", "5", "6", "7"];
  return (
    <>
      <div className="bg-card/70 ring-border text-muted-foreground absolute top-5 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[10px] ring-1">
        <Lock className="size-2.5" />
        {SLUG}.co/anna-studio
      </div>
      <Window className="top-14 p-4">
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
          {days.map((d, i) => (
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
      </Window>
    </>
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
    <Window className="top-8 w-[min(310px,calc(100%-2rem))] overflow-hidden">
      <div className="border-border flex items-center gap-1.5 border-b px-3 py-2">
        <span className="bg-border size-2 rounded-full" />
        <span className="bg-border size-2 rounded-full" />
        <span className="bg-border size-2 rounded-full" />
        <span className="text-muted-foreground ml-1.5 font-mono text-[10px]">index.html</span>
      </div>
      <pre className="p-3 font-mono text-[10.5px] leading-5 whitespace-pre-wrap break-all">
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

/* Manage: the confirmation email's two buttons — no account, just the link. */
function ManageMock() {
  return (
    <Window className="top-8 p-4">
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
  );
}

/* Reminder: a notification, with the confirmation it followed tucked behind. */
function ReminderMock() {
  return (
    <>
      <Window className="top-6 scale-95 p-3.5 opacity-50">
        <div className="flex items-center gap-2.5">
          <span className="bg-secondary text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-full">
            <Mail className="size-3.5" />
          </span>
          <span className="text-muted-foreground text-[12px]">Confirmation sent · 3 days ago</span>
        </div>
      </Window>
      <Window className="top-14 p-3.5">
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
    <Window className="top-8 p-4">
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
