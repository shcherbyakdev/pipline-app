import { Check, ChevronLeft, ChevronRight, Globe } from "lucide-react";
import { toDisplayName } from "@/features/scheduling/handle";
import { SPACES } from "@/features/orgs/vocab";
import { cn } from "@/lib/utils";

/* What a client sees at booklo.co/<handle>, in either channel: the provider,
   what they offer (services or spaces), a month to pick from, then the time —
   a slot for an appointment, an hourly window for a space. Static fixtures,
   896px design width (scaled by ScaledFrame). The name follows the claim bar
   live; the hero's tab pill picks the mode. */

export type MockMode = "appointments" | "spaces";

const SERVICES = [
  { name: "Consultation", blurb: "First session, in person or online", meta: "30 min", selected: true },
  { name: "Follow-up", blurb: "For existing clients", meta: "15 min", selected: false },
  { name: "Deep dive", blurb: "A full working session", meta: "60 min", selected: false },
];
const SPACE_ITEMS = [
  { name: "Studio A", blurb: "Rehearsal room · 2 units", meta: "by the hour · 1–4 h", selected: true },
  { name: "Meeting room", blurb: "Seats 8, screen, whiteboard", meta: "by the hour", selected: false },
  { name: "Lake cabin", blurb: "Sleeps 4, self check-in", meta: "per night · min 2 nights", selected: false },
];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// 35 cells: null = previous/next month, number = day; open days are bookable.
const OPEN = new Set([3, 4, 5, 10, 11, 12, 17, 18, 19, 24, 25, 26]);
const SELECTED_DAY = 11;
const DAYS: (number | null)[] = [null, null, ...Array.from({ length: 30 }, (_, i) => i + 1), null, null, null];
const SLOTS = ["9:00", "10:30", "13:00", "14:30", "16:00"];
const SELECTED_SLOT = "10:30";
const HOURS = ["9", "10", "11", "12", "13", "14", "15", "16", "17"];
const WINDOW = [4, 5]; // 13:00–15:00

export function BookingPageMock({ handle, mode = "appointments" }: { handle: string; mode?: MockMode }) {
  const name = toDisplayName(handle) || "Your Name";
  const initial = name[0]?.toUpperCase() ?? "Y";
  const spaces = mode === "spaces";
  const items = spaces ? SPACE_ITEMS : SERVICES;

  return (
    // The caption is the only thing assistive tech gets; the decorative
    // grid is hidden. `contents` keeps the two columns in the figure's grid.
    <figure className="bg-card grid grid-cols-[312px_1fr]">
      <figcaption className="sr-only">Preview of a Booklo booking page</figcaption>
      <div className="contents" aria-hidden="true">
        {/* left: identity + what's on offer */}
        <div className="border-border flex flex-col gap-7 border-r p-8">
          <div className="flex items-center gap-3.5">
            <div className="bg-highlight text-primary-foreground flex size-12 shrink-0 items-center justify-center rounded-2xl text-lg font-medium">
              {initial}
            </div>
            <div className="min-w-0">
              <p className="text-foreground truncate text-[17px] leading-tight font-medium">{name}</p>
              <p className="text-muted-foreground mt-0.5 text-xs">{spaces ? "Book a space" : "Book a session"}</p>
            </div>
          </div>
          <div>
            <p className="text-muted-foreground font-mono text-[10px] tracking-[0.14em] uppercase">{spaces ? SPACES.widgetGroup : "Services"}</p>
            <ul className="mt-3 flex flex-col gap-2">
              {items.map((s) => (
                <li
                  key={s.name}
                  className={cn(
                    "flex items-start gap-3 rounded-xl p-3 ring-1",
                    s.selected ? "bg-highlight/6 ring-highlight" : "ring-border",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full ring-1",
                      s.selected ? "bg-highlight ring-highlight text-primary-foreground" : "ring-input",
                    )}
                  >
                    {s.selected ? <Check className="size-2.5" strokeWidth={3} /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-foreground block text-sm leading-tight font-medium">{s.name}</span>
                    <span className="text-muted-foreground mt-0.5 block text-[11px]">{s.blurb}</span>
                    <span className="text-muted-foreground mt-1.5 block font-mono text-[10px] tracking-wider uppercase">{s.meta}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-muted-foreground mt-auto flex items-center gap-1.5 text-[11px]">
            <Globe className="size-3" />
            Europe/Warsaw · shown in your local time
          </p>
        </div>

        {/* right: month + time */}
        <div className="p-8">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-muted-foreground font-mono text-[10px] tracking-[0.14em] uppercase">Pick a date</p>
              <p className="text-foreground mt-1 text-[17px] font-medium">October 2026</p>
            </div>
            <div className="flex gap-1.5">
              <span className="ring-border text-muted-foreground flex size-8 items-center justify-center rounded-full ring-1">
                <ChevronLeft className="size-3.5" />
              </span>
              <span className="ring-border text-foreground flex size-8 items-center justify-center rounded-full ring-1">
                <ChevronRight className="size-3.5" />
              </span>
            </div>
          </div>
          <div className="text-muted-foreground mt-4 grid grid-cols-7 text-center font-mono text-[10px] tracking-wider uppercase">
            {WEEKDAYS.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="mt-1.5 grid grid-cols-7 justify-items-center gap-y-1">
            {DAYS.map((d, i) => {
              const open = d !== null && OPEN.has(d);
              return (
                <span
                  key={i}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full text-[13px]",
                    d === null && "invisible",
                    !open && "text-muted-foreground/50",
                    open && d !== SELECTED_DAY && "bg-highlight/8 text-highlight font-medium",
                    d === SELECTED_DAY && "bg-highlight text-primary-foreground font-medium",
                  )}
                >
                  {d ?? ""}
                </span>
              );
            })}
          </div>

          <div className="border-border mt-4 border-t pt-4">
            <div className="flex items-center justify-between">
              <p className="text-foreground text-sm font-medium">Saturday, October 11</p>
              <p className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">{spaces ? "Studio A · 1 of 2 free" : "30 min"}</p>
            </div>

            {spaces ? (
              <>
                <div className="mt-3 flex gap-1">
                  {HOURS.map((h, i) => {
                    const inWindow = i >= WINDOW[0] && i <= WINDOW[1];
                    return (
                      <span
                        key={h}
                        className={cn(
                          "flex h-9 flex-1 items-center justify-center text-[12px]",
                          inWindow ? "bg-highlight text-primary-foreground font-medium" : "ring-border rounded-md ring-1",
                          i === WINDOW[0] && "rounded-l-md",
                          i === WINDOW[1] && "rounded-r-md",
                        )}
                      >
                        {h}
                      </span>
                    );
                  })}
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <p className="text-foreground text-[13px]">
                    13:00 – 15:00 <span className="text-muted-foreground font-mono text-[11px]">· 2 h</span>
                  </p>
                  <span className="bg-highlight text-primary-foreground rounded-full px-4 py-2 text-[13px] font-medium">Confirm</span>
                </div>
              </>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                {SLOTS.map((t) =>
                  t === SELECTED_SLOT ? (
                    <span key={t} className="ring-highlight flex overflow-hidden rounded-full ring-1">
                      <span className="bg-highlight/8 text-highlight px-4 py-2 text-[13px] font-medium">{t}</span>
                      <span className="bg-highlight text-primary-foreground px-4 py-2 text-[13px] font-medium">Confirm</span>
                    </span>
                  ) : (
                    <span key={t} className="ring-border text-foreground rounded-full px-4 py-2 text-[13px] ring-1">
                      {t}
                    </span>
                  ),
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </figure>
  );
}
