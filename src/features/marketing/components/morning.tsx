"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { SECTIONS } from "@/features/marketing/site";
import { cn } from "@/lib/utils";
import { Reveal } from "./reveal";
import { useStoryLoop } from "./story-loop";
import { H2, LEAD, SECTION } from "./type";

/* The daily action list (the Overview's morning list, spec 2026-09-08 S4)
   as one card on the plain ground: four groups, one line per thing that
   needs a human, the action as a pill. The story: the owner works down the
   list before the first shoot; each pill becomes a check and the count in
   the header falls. Sample names only. */

/* Steps: 0 fresh · 1 reminded · 2 approved · 3 collected · 4 confirmed · 5 leave. */
const AT = [0, 1500, 3000, 4500, 6000, 9600] as const;
const PERIOD = 10400;
const S = { fresh: 0, reminded: 1, approved: 2, collected: 3, confirmed: 4, leave: 5 } as const;

type Item = { who: string; what: string; meta: string; action: string; done: string; at: number | null };
type Group = { title: string; items: Item[] };
const GROUPS: Group[] = [
  {
    title: "Holds expiring today",
    items: [
      { who: "Mia Novak", what: "Room A, Sat 11, 10:00 to 14:00", meta: "228 zł by 16:40", action: "Remind", done: "Reminded", at: S.reminded },
      { who: "Jan Kowalski", what: "Room B, Sun 12, 9:00 to 12:00", meta: "111 zł by 18:00", action: "Remind", done: "Reminded", at: null },
    ],
  },
  {
    title: "Requests waiting",
    items: [{ who: "Kasia Wójcik", what: "Whole studio, Fri 17, event for 40", meta: "9:00 to 17:00", action: "Approve", done: "Approved", at: S.approved }],
  },
  {
    title: "Balances due",
    items: [{ who: "Tom Reyes", what: "Overtime and 3 extra people", meta: "130 zł, 12 days", action: "Collect", done: "Link sent", at: S.collected }],
  },
  {
    title: "Changes to confirm",
    items: [{ who: "Lena Fischer", what: "Moved to Sat 25, 48 h tier", meta: "+40 zł", action: "Confirm", done: "Confirmed", at: S.confirmed }],
  },
];
const TOTAL = GROUPS.reduce((n, g) => n + g.items.length, 0);

const EASE = "transition-[background-color,color,opacity] duration-300 ease-strong motion-reduce:transition-none";

function List() {
  const step = useStoryLoop(AT, PERIOD, S.confirmed);
  const on = (s: number | null) => s !== null && step >= s && step < S.leave;
  const doneCount = GROUPS.flatMap((g) => g.items).filter((it) => on(it.at)).length;
  const left = TOTAL - doneCount;
  return (
    <div
      aria-hidden="true"
      className={cn(
        "bg-card ring-border mx-auto w-full max-w-3xl rounded-[24px] shadow-[var(--shadow-card)] ring-1 transition-opacity duration-500 ease-strong motion-reduce:transition-none",
        step === S.leave ? "opacity-0" : "opacity-100",
      )}
    >
      <div className="flex items-baseline justify-between gap-4 px-6 pt-6 sm:px-7">
        <p className="text-foreground text-[16px] font-medium">Tuesday, October 6</p>
        <p className={cn("text-muted-foreground font-mono text-[13px] tabular-nums", EASE, left === 0 && "text-kind-space-text")}>
          {left === 0 ? "All done" : `${left} left`}
        </p>
      </div>
      <div className="flex flex-col gap-5 p-6 pt-5 sm:p-7 sm:pt-5">
        {GROUPS.map((g) => (
          <div key={g.title}>
            <p className="text-subtle text-[12px] font-medium">{g.title}</p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {g.items.map((it) => {
                const done = on(it.at);
                return (
                  <li key={it.who} className={cn("bg-secondary flex items-center gap-3 rounded-[12px] py-2.5 pr-2.5 pl-3.5", EASE, done && "opacity-60")}>
                    <span className="min-w-0 flex-1">
                      <span className="text-foreground block truncate text-[13.5px] font-medium">{it.who}</span>
                      <span className="text-muted-foreground block truncate text-[12px]">{it.what}</span>
                    </span>
                    <span className="text-muted-foreground hidden shrink-0 font-mono text-[11.5px] tabular-nums sm:inline">{it.meta}</span>
                    <span
                      className={cn(
                        "inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-[12.5px] font-medium",
                        EASE,
                        done ? "bg-kind-space-soft text-kind-space-text" : "bg-foreground text-background",
                      )}
                    >
                      {done ? (
                        <React.Fragment>
                          <Check className="size-3" strokeWidth={3} />
                          {it.done}
                        </React.Fragment>
                      ) : (
                        it.action
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Morning() {
  return (
    <section aria-labelledby="morning-heading" className={SECTION}>
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 id="morning-heading" className={H2}>
            {SECTIONS.morning.heading}
          </h2>
          <p className={cn(LEAD, "mx-auto max-w-xl")}>{SECTIONS.morning.sub}</p>
        </Reveal>
        <Reveal delay={60} className="mt-12 md:mt-14">
          <List />
        </Reveal>
      </div>
    </section>
  );
}
