import { toDisplayName } from "@/features/scheduling/handle";
import { cn } from "@/lib/utils";

/* What a client sees at booklo.co/<handle>: name, two services, a month grid
   with a few open days, a slot column. Static fixtures, 896px design width
   (scaled by ScaledFrame). The name follows the claim bar live. */

const SERVICES = [
  { name: "Consultation", duration: "30 min", selected: true },
  { name: "Follow-up", duration: "15 min", selected: false },
];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// 35 cells: null = previous/next month, number = day; open days are bookable.
const OPEN = new Set([3, 4, 5, 10, 11, 12, 17, 18, 19, 24, 25, 26]);
const SELECTED_DAY = 11;
const DAYS: (number | null)[] = [null, null, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, null, null, null];
const SLOTS = ["9:00", "10:30", "13:00", "14:30", "16:00"];
const SELECTED_SLOT = "10:30";

export function BookingPageMock({ handle }: { handle: string }) {
  const name = toDisplayName(handle) || "Your Name";
  const initial = name[0]?.toUpperCase() ?? "Y";

  return (
    // The caption is the only thing assistive tech gets; the decorative
    // grid is hidden. `contents` keeps the two columns in the figure's grid.
    <figure className="bg-background grid grid-cols-[300px_1fr] gap-0">
      <figcaption className="sr-only">Preview of a Booklo booking page</figcaption>
      <div className="contents" aria-hidden="true">

      {/* left: identity + services */}
      <div className="border-border flex flex-col gap-6 border-r p-8">
        <div className="flex items-center gap-3">
          <div className="bg-highlight text-primary-foreground flex size-10 items-center justify-center rounded-full text-sm font-medium">
            {initial}
          </div>
          <div>
            <p className="text-foreground text-lg leading-tight font-medium">{name}</p>
            <p className="text-muted-foreground text-xs">Book a session</p>
          </div>
        </div>
        <ul className="flex flex-col gap-2">
          {SERVICES.map((s) => (
            <li
              key={s.name}
              className={cn(
                "flex items-center justify-between rounded-lg px-3 py-2.5 text-sm ring-1",
                s.selected ? "bg-card ring-highlight" : "ring-border",
              )}
            >
              <span className="text-foreground">{s.name}</span>
              <span className="text-muted-foreground text-xs">{s.duration}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* right: month + slots */}
      <div className="grid grid-cols-[1fr_120px] gap-6 p-8">
        <div>
          <div className="mb-4 flex items-center justify-between">
            <p className="text-foreground text-sm font-medium">October</p>
            <div className="text-muted-foreground flex gap-2 text-xs">
              <span>‹</span>
              <span>›</span>
            </div>
          </div>
          <div className="text-muted-foreground mb-2 grid grid-cols-7 text-center text-[10px]">
            {WEEKDAYS.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {DAYS.map((d, i) => (
              <div
                key={i}
                className={cn(
                  "flex h-9 items-center justify-center rounded-md text-xs",
                  d === null && "opacity-0",
                  d !== null && !OPEN.has(d) && "text-muted-foreground/60",
                  d !== null && OPEN.has(d) && d !== SELECTED_DAY && "bg-card text-foreground ring-border font-medium ring-1",
                  d === SELECTED_DAY && "bg-highlight text-primary-foreground font-medium",
                )}
              >
                {d ?? ""}
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-[10px] tracking-wider uppercase">Wed {SELECTED_DAY}</p>
          {SLOTS.map((t) => (
            <div
              key={t}
              className={cn(
                "rounded-md px-3 py-2 text-center text-xs ring-1",
                t === SELECTED_SLOT ? "bg-highlight text-primary-foreground ring-highlight" : "bg-card text-foreground ring-border",
              )}
            >
              {t}
            </div>
          ))}
        </div>
      </div>
      </div>
    </figure>
  );
}
