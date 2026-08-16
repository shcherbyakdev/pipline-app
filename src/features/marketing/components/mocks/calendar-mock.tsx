import { cn } from "@/lib/utils";

const DAYS = ["Mon 18", "Tue 19", "Wed 20", "Thu 21", "Fri 22"];
const HOURS = [9, 10, 11, 12, 13, 14, 15, 16]; // 09:00–17:00
const ROW = 2.25; // rem per hour

type Item = { day: number; start: number; end: number; title: string; who?: string; kind: "booking" | "blocked" };
const ITEMS: Item[] = [
  { day: 0, start: 9.5, end: 10.5, title: "Consultation", who: "Mia Novak", kind: "booking" },
  { day: 1, start: 11, end: 11.5, title: "Intro call", who: "Tom Reyes", kind: "booking" },
  { day: 2, start: 14, end: 15, title: "Consultation", who: "Priya Nair", kind: "booking" },
  { day: 3, start: 12, end: 13, title: "Blocked", kind: "blocked" },
  { day: 4, start: 10, end: 11, title: "Consultation", who: "Jonas Berg", kind: "booking" },
];

export function CalendarMock() {
  const gridHeight = `${HOURS.length * ROW}rem`;
  return (
    <div aria-hidden="true" className="bg-card overflow-hidden rounded-xl border">
      {/* Below ~44rem the five day columns stop being legible, so the grid keeps
          its minimum width and scrolls sideways inside the card instead. */}
      {/* tabIndex={-1}: the card is aria-hidden, so this scroller must stay out of the tab order. */}
      <div tabIndex={-1} className="overflow-x-auto">
        <div className="min-w-[44rem] text-xs">
          <div className="grid grid-cols-[3rem_repeat(5,1fr)] border-b">
            <div />
            {DAYS.map((d, i) => (
              <div key={d} className={i === 2 ? "text-primary py-2 text-center font-medium" : "text-muted-foreground py-2 text-center"}>
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-[3rem_repeat(5,1fr)]" style={{ height: gridHeight }}>
            <div className="relative">
              {HOURS.map((h, i) => (
                <span
                  key={h}
                  // Every label is centred on its gridline, except the first: centring it on the
                  // grid's top edge would push it under the day-header row, so it hangs below instead.
                  className={cn("text-muted-foreground absolute right-2", i === 0 ? "translate-y-0.5" : "-translate-y-1/2")}
                  style={{ top: `${i * ROW}rem` }}
                >
                  {`${String(h).padStart(2, "0")}:00`}
                </span>
              ))}
            </div>
            {DAYS.map((_, day) => (
              <div key={day} className="relative border-l">
                {HOURS.map((h, i) => (
                  <div key={h} className="absolute inset-x-0 border-t" style={{ top: `${i * ROW}rem` }} />
                ))}
                {ITEMS.filter((it) => it.day === day).map((it) => (
                  <div
                    key={it.title + it.start}
                    className={
                      it.kind === "blocked"
                        ? "bg-muted text-muted-foreground absolute inset-x-1 rounded-md border border-dashed px-2 py-1"
                        : "bg-primary/10 text-foreground border-primary absolute inset-x-1 rounded-md border-l-2 px-2 py-1"
                    }
                    style={{ top: `${(it.start - HOURS[0]) * ROW}rem`, height: `${(it.end - it.start) * ROW}rem` }}
                  >
                    <p className="truncate font-medium">{it.title}</p>
                    {it.who ? <p className="text-muted-foreground truncate">{it.who}</p> : null}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
