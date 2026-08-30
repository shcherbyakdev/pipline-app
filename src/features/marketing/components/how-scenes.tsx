import { cn } from "@/lib/utils";

/* One product fragment per step, drawn as a white frame on a soft grey
   stage. Each carries one small loop (keyframes in globals.css under "How
   scenes", `hs-*`): the service name types itself, the embedded widget
   settles into the site, the bookings arrive row by row. Transform,
   opacity and clip-path only; base styles are the finished frame so reduced
   motion shows the end state. Decorative: the stage is aria-hidden. Sample
   names only. */

export function Stage({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div aria-hidden="true" className={cn("bg-secondary rounded-[24px] p-6 sm:p-9", className)}>
      <div className="bg-card rounded-2xl p-5 shadow-[var(--shadow-card)]">{children}</div>
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-subtle text-[12px] leading-none font-medium">{label}</span>
      {children}
    </div>
  );
}

const box = "ring-input rounded-[10px] px-3 py-2.5 text-[13.5px] leading-none ring-1 ring-inset";
const seg = "flex-1 rounded-[10px] py-2.5 text-center text-[13px] leading-none ring-1 ring-inset";

/* 1. Add: the service form fills in. */
export function AddScene() {
  return (
    <div className="flex flex-col gap-3.5">
      <Field label="Service name">
        <div className={cn(box, "ring-foreground ring-[1.5px]")}>
          <span className="hs-type inline-block align-bottom whitespace-nowrap">Consultation</span>
          <span className="hs-caret bg-foreground ml-0.5 inline-block h-3.5 w-[1.5px] align-[-2px]" />
        </div>
      </Field>
      <Field label="Duration">
        <div className="flex gap-1.5">
          {["15 min", "30 min", "45 min", "1 h"].map((d) => (
            <span key={d} className={cn(seg, d === "30 min" ? "bg-foreground text-background ring-foreground" : "ring-input")}>
              {d}
            </span>
          ))}
        </div>
      </Field>
      <Field label="Where">
        <div className="flex gap-1.5">
          {["Online", "In person"].map((w) => (
            <span key={w} className={cn(seg, w === "Online" ? "bg-foreground text-background ring-foreground" : "ring-input")}>
              {w}
            </span>
          ))}
        </div>
      </Field>
      <Field label="Open">
        <div className={box}>Mon to Fri, 9:00 to 17:00</div>
      </Field>
    </div>
  );
}

/* 2. Share: one script tag, and the widget settles into a site. */
export function ShareScene() {
  return (
    <div>
      <pre className="bg-foreground text-[#d8d8d3] overflow-x-auto rounded-xl px-4 py-3.5 font-mono text-[12.5px] leading-[1.65]">
        {"<"}
        <span className="text-[#8fc4ff]">script</span>
        {' src="https://booklo.co/embed.js"\n  data-page="anna-studio">'}
        {"</"}
        <span className="text-[#8fc4ff]">script</span>
        {">"}
      </pre>
      <div className="ring-input mt-3.5 rounded-xl p-3 ring-1 ring-inset">
        <div className="mb-2.5 flex items-center gap-3 text-[11px] leading-none">
          <span className="text-foreground font-semibold">Anna Studio</span>
          <span className="text-subtle">Classes</span>
          <span className="text-subtle">Studio hire</span>
          <span className="text-foreground ml-auto font-medium">Book</span>
        </div>
        <div className="hs-grow ring-input flex flex-col gap-1.5 rounded-[10px] p-2.5 ring-1 ring-inset">
          {[
            ["Consultation", "30 min"],
            ["Workshop", "2 h"],
          ].map(([t, d]) => (
            <div key={t} className="ring-input flex justify-between rounded-lg px-2.5 py-2 text-[12px] leading-none ring-1 ring-inset">
              <span>{t}</span>
              <span className="text-subtle">{d}</span>
            </div>
          ))}
          <div className="bg-foreground text-background rounded-lg px-2.5 py-2 text-center text-[12px] leading-none font-medium">Book now</div>
        </div>
      </div>
    </div>
  );
}

/* 3. Book: bookings of every kind arrive, confirmed. */
const ROWS: { kind: "time" | "space" | "stay" | "class"; who: string; tag: string; tone: "ok" | "warm" | "grey"; when: string }[] = [
  { kind: "time", who: "Mia Novak, Consultation", tag: "Confirmed", tone: "ok", when: "Sat 17, 10:30" },
  { kind: "space", who: "Tom Rivera, Studio A, Room 2", tag: "Confirmed", tone: "ok", when: "Sat 17, 11:00 to 14:00" },
  { kind: "stay", who: "Lena Fischer, Lake cabin", tag: "Reminder sent", tone: "warm", when: "Fri 23 to Sun 25" },
  { kind: "class", who: "Jan Kowalski, Yoga class", tag: "Rescheduled", tone: "grey", when: "Tue 20, 18:00" },
];
const DOT = { time: "bg-kind-time", space: "bg-kind-space", stay: "bg-kind-stay", class: "bg-kind-class" } as const;
const TAG = { ok: "bg-kind-space-soft text-kind-space-text", warm: "bg-kind-stay-soft text-kind-stay-text", grey: "bg-accent text-muted-foreground" } as const;

export function BookScene() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-x-7 gap-y-2.5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {ROWS.map((r, i) => (
        <div key={r.who} className={cn("hs-row border-border flex min-w-0 items-center gap-3 border-b py-3 text-[13.5px] leading-none", `hs-row-${i + 1}`)}>
          <i className={cn("size-2 shrink-0 rounded-full", DOT[r.kind])} />
          <span className="min-w-0 flex-1 truncate">{r.who}</span>
          <span className={cn("shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold", TAG[r.tone])}>{r.tag}</span>
          <span className="text-subtle hidden shrink-0 font-mono text-[11.5px] sm:inline">{r.when}</span>
        </div>
      ))}
    </div>
  );
}
