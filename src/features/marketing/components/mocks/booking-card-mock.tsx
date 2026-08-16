import { Check } from "lucide-react";

const SERVICES = [
  { name: "Intro call", meta: "30 min · Free" },
  { name: "Consultation", meta: "60 min · €80" },
];
const DAYS = ["Mon 18", "Tue 19", "Wed 20", "Thu 21", "Fri 22"];
const SLOTS = ["09:00", "09:30", "10:30", "11:00", "14:00", "15:30"];

export function BookingCardMock() {
  return (
    <div aria-hidden="true" className="bg-card w-full max-w-md rounded-xl border p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="bg-primary/15 text-primary flex size-9 items-center justify-center rounded-lg text-sm font-semibold">A</div>
        <div>
          <p className="text-sm font-medium leading-tight">Anna Kovač — Coaching</p>
          <p className="text-muted-foreground text-xs">Times shown in your timezone</p>
        </div>
      </div>

      <div className="mt-5 space-y-2">
        {SERVICES.map((s, i) => (
          <div
            key={s.name}
            className={
              i === 1
                ? "border-primary bg-primary/5 flex items-center justify-between rounded-lg border px-3 py-2"
                : "flex items-center justify-between rounded-lg border px-3 py-2"
            }
          >
            <span className="text-sm font-medium">{s.name}</span>
            <span className="text-muted-foreground text-xs">{s.meta}</span>
          </div>
        ))}
      </div>

      <div className="mt-5 grid grid-cols-5 gap-1">
        {DAYS.map((d, i) => (
          <div
            key={d}
            className={
              i === 2
                ? "bg-primary text-primary-foreground rounded-md py-1.5 text-center text-xs font-medium"
                : "bg-muted rounded-md py-1.5 text-center text-xs"
            }
          >
            {d}
          </div>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {SLOTS.map((t, i) => (
          <div
            key={t}
            className={
              i === 3
                ? "border-primary text-primary rounded-md border py-1.5 text-center text-xs font-medium"
                : "rounded-md border py-1.5 text-center text-xs"
            }
          >
            {t}
          </div>
        ))}
      </div>

      <div className="bg-primary text-primary-foreground mt-5 flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium">
        <Check className="size-4" /> Confirm Wed 20 · 11:00
      </div>
    </div>
  );
}
