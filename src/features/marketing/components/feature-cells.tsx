import { cn } from "@/lib/utils";
import type { FeatureVisual } from "@/features/marketing/site";

/* One small product fragment per feature, for the bento. White fragment on
   the cell's ground; a couple carry a quiet loop (keyframes in globals.css
   under "Feature cells", `fc-*`). Decorative: the fragments are aria-hidden
   by the cell. Sample names only. */

function Frag({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("bg-card flex min-h-[170px] flex-col justify-center gap-2 rounded-[14px] p-4 shadow-[var(--shadow-card)]", className)}>{children}</div>;
}

function Row({ children, on, className }: { children: React.ReactNode; on?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between rounded-[10px] px-3 py-2.5 text-[13px] leading-none font-medium ring-1 ring-inset", on ? "bg-secondary ring-foreground ring-[1.5px]" : "ring-input", className)}>
      {children}
    </div>
  );
}

/* Double-booking impossible: a person's slot and a room's window, both guarded. */
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
          <Row>
            <span>Tom, 11:00</span>
            <span className="text-kind-space-text font-semibold">Booked</span>
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
          <Row>
            <span>Room 2, 14:00 to 17:00</span>
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
            <div key={t} className="ring-input mb-1.5 flex justify-between rounded-[7px] px-2 py-[7px] font-medium ring-1 ring-inset">
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

/* Self-serve reschedule: the client picks another time from their link. */
function Manage() {
  return (
    <Frag className="fc-sel">
      {["Mon 24, 9:00", "Tue 25, 14:30", "Wed 26, 10:00"].map((t) => (
        <Row key={t} className="fc-row">
          <span>{t}</span>
        </Row>
      ))}
    </Frag>
  );
}

/* Reminders: two went out. */
function Reminder() {
  return (
    <Frag>
      <Row>
        <span>Tomorrow 10:30, Consultation</span>
        <span className="text-subtle font-normal">sent</span>
      </Row>
      <Row>
        <span>Fri 15:00, Lake cabin check-in</span>
        <span className="text-subtle font-normal">sent</span>
      </Row>
    </Frag>
  );
}

/* Embed: one script tag, on ink. */
function Embed() {
  return (
    <pre className="flex min-h-[170px] items-center overflow-x-auto rounded-[14px] bg-[#2a2a27] px-4 py-3.5 font-mono text-[12px] leading-[1.65] text-[#d8d8d3]">
      {"<"}
      <span className="text-[#8fc4ff]">script</span>
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
          <i key={i} className={cn("block h-[34px] rounded-[7px]", i >= 2 && i <= 4 ? "fc-fill bg-kind-space" : "bg-card ring-input ring-1 ring-inset")} />
        ))}
      </div>
      <div className="text-subtle flex justify-between font-mono text-[11px] leading-none">
        <span>Studio A, Room 1</span>
        <span>11:00 to 14:00</span>
      </div>
    </Frag>
  );
}

/* Your brand: a colour picked, the page recoloured. */
const SWATCHES = ["#1c1c1a", "var(--kind-time)", "var(--kind-stay)", "var(--kind-space)", "var(--kind-class)"];
function Brand() {
  return (
    <Frag>
      <div className="flex gap-2.5">
        {SWATCHES.map((c, i) => (
          <i key={c} className={cn("block size-[30px] rounded-full", i === 2 && "shadow-[0_0_0_2px_var(--card),0_0_0_4px_var(--foreground)]")} style={{ background: c }} />
        ))}
      </div>
      <div className="ring-input mt-3.5 flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-[13px] leading-none font-medium ring-1 ring-inset">
        <span className="bg-kind-stay grid size-[26px] place-items-center rounded-lg text-[12px] font-semibold text-white">A</span>
        Anna Studio
        <span className="bg-kind-stay ml-auto rounded-full px-2.5 py-1.5 text-[12px] text-white">Book now</span>
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
