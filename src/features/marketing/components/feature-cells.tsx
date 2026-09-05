import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import type { FeatureVisual } from "@/features/marketing/site";

/* One small product fragment per feature, for the bento. White fragment on
   the cell's ground; rows are borderless soft fills, and an "on" row is a
   white card with the lift shadow — the same active-state idiom the app
   uses. Four fragments carry a quiet explanatory loop (keyframes in
   globals.css under "Feature cells", `fc-*`): the reschedule picker's
   selection glides, the reminders get sent, the room's day fills, the brand
   swatch ring slides while the page recolours. Decorative: the fragments
   are aria-hidden by the cell. Sample names only. */

function Frag({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("bg-card flex min-h-[170px] flex-col justify-center gap-2 rounded-[16px] p-4 shadow-[var(--shadow-card)]", className)}>{children}</div>;
}

function Row({ children, on, className }: { children: React.ReactNode; on?: boolean; className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between rounded-[10px] px-3 py-2.5 text-[13px] leading-none font-medium",
        on ? "bg-card ring-input shadow-[var(--shadow-lift)] ring-1 ring-inset" : "bg-muted",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* Double-booking impossible: a person's slot and a room's window, both
   guarded. Still on purpose — the point is that nothing moves. */
function Guard() {
  return (
    <Frag>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Row on>
            <span>Mia, 10:30</span>
            <span className="text-kind-space-text font-semibold">Booked</span>
          </Row>
          <Row>
            <span>Tom, 10:30</span>
            <span className="text-danger font-semibold">taken</span>
          </Row>
        </div>
        <div className="flex flex-col gap-2">
          <Row>
            <span>Room 1, 11:00 to 14:00</span>
            <span className="text-kind-space-text font-semibold">Booked</span>
          </Row>
          <Row>
            <span>Room 2, 11:00 to 14:00</span>
            <span className="text-subtle font-normal">free</span>
          </Row>
        </div>
      </div>
    </Frag>
  );
}

/* Hosted booking page: the phone it will be opened on. */
function Page() {
  return (
    <Frag className="p-2.5">
      <div className="bg-foreground mx-auto w-[150px] rounded-[26px] p-2">
        <div className="bg-card rounded-[20px] px-2.5 py-3 text-[10px] leading-none">
          <div className="mb-2 text-[11px] font-semibold">Anna Studio</div>
          {[
            ["Consultation", "30 min"],
            ["Workshop", "2 h"],
          ].map(([t, d]) => (
            <div key={t} className="bg-muted mb-1.5 flex justify-between rounded-[7px] px-2 py-[7px] font-medium">
              <span>{t}</span>
              <span className="text-subtle font-normal">{d}</span>
            </div>
          ))}
          <div className="bg-foreground text-background mt-1.5 rounded-full py-[7px] text-center font-medium">Book now</div>
        </div>
      </div>
    </Frag>
  );
}

/* Self-serve reschedule: the client picks another time from their link. A
   white selection card glides down the list (transform only). */
function Manage() {
  return (
    <Frag>
      <div className="relative flex flex-col gap-2">
        <div aria-hidden className="fc-slide bg-card ring-input pointer-events-none absolute inset-x-0 top-0 h-[38px] rounded-[10px] shadow-[var(--shadow-lift)] ring-1 ring-inset" />
        {["Mon 24, 9:00", "Tue 25, 14:30", "Wed 26, 10:00"].map((t) => (
          <div key={t} className="relative flex h-[38px] items-center rounded-[10px] px-3 text-[13px] leading-none font-medium">
            {t}
          </div>
        ))}
      </div>
    </Frag>
  );
}

/* Reminders: they go out on their own — "sent" lands on one row, then the
   next. */
function Reminder() {
  return (
    <Frag>
      <Row>
        <span>Tomorrow 10:30, Consultation</span>
        <span className="fc-sent text-kind-space-text flex items-center gap-1 font-medium">
          <Check className="size-3" strokeWidth={3} />
          sent
        </span>
      </Row>
      <Row>
        <span>Fri 15:00, Lake cabin check-in</span>
        <span className="fc-sent fc-sent-2 text-kind-space-text flex items-center gap-1 font-medium">
          <Check className="size-3" strokeWidth={3} />
          sent
        </span>
      </Row>
    </Frag>
  );
}

/* Embed: one script tag, on ink. */
function Embed() {
  return (
    <pre className="flex min-h-[170px] items-center overflow-x-auto rounded-[16px] bg-white/6 px-4 py-3.5 font-mono text-[12px] leading-[1.65] text-[#dcd8e6] ring-1 ring-white/10 ring-inset">
      {"<"}
      <span className="text-[#828fff]">script</span>
      {' src="booklo.co/embed.js"\n  data-page="anna-studio">'}
    </pre>
  );
}

/* Spaces by the hour or night: a room's day filling, and a stay. */
function Spaces() {
  return (
    <Frag>
      <div className="text-subtle flex justify-between font-mono text-[11px] leading-none">
        <span>9:00</span>
        <span>17:00</span>
      </div>
      <div className="grid grid-cols-8 gap-1">
        {Array.from({ length: 8 }, (_, i) => (
          <i key={i} className={cn("block h-[34px] rounded-[7px]", i >= 2 && i <= 4 ? "fc-fill bg-kind-space" : "bg-muted")} />
        ))}
      </div>
      <div className="text-subtle flex justify-between font-mono text-[11px] leading-none">
        <span>Studio A, Room 1</span>
        <span>11:00 to 14:00</span>
      </div>
    </Frag>
  );
}

/* Your brand: the swatch ring slides, the page recolours with it. */
const SWATCHES = ["var(--foreground)", "var(--brand)", "var(--kind-stay)", "var(--kind-space)", "var(--kind-class)"];
function Brand() {
  return (
    <Frag>
      <div className="relative flex gap-2.5">
        <i aria-hidden className="fc-swatch ring-foreground pointer-events-none absolute top-0 left-0 block size-[30px] rounded-full ring-2 ring-offset-2 ring-offset-[var(--card)]" />
        {SWATCHES.map((c) => (
          <i key={c} className="block size-[30px] rounded-full" style={{ background: c }} />
        ))}
      </div>
      <div className="bg-muted mt-3.5 flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-[13px] leading-none font-medium">
        <span className="fc-chip text-on-kind grid size-[26px] place-items-center rounded-lg text-[12px] font-semibold">A</span>
        Anna Studio
        <span className="fc-chip text-on-kind ml-auto rounded-full px-2.5 py-1.5 text-[12px] font-medium">Book now</span>
      </div>
    </Frag>
  );
}

const CELLS: Record<FeatureVisual, () => React.ReactNode> = {
  "slot-guard": Guard,
  page: Page,
  manage: Manage,
  reminder: Reminder,
  embed: Embed,
  spaces: Spaces,
  brand: Brand,
};

export function FeatureCell({ visual }: { visual: FeatureVisual }) {
  const Cell = CELLS[visual];
  return <Cell />;
}
