"use client";

import * as React from "react";
import { SECTIONS } from "@/features/marketing/site";
import { cn } from "@/lib/utils";
import { Reveal } from "./reveal";
import { useStoryLoop } from "./story-loop";
import { BlobWash } from "./booklo-mark";
import { H2, LEAD, SECTION, SECTION_INNER } from "./type";

/* Compound resources: a left-aligned heading, then one day of the studio
   as a tape chart telling its own story, the mint blob behind it. Mia books Room
   A with the Profoto kit (two rows fill at once); Tom books the whole
   studio (one block across every room); Lena asks for the kit while Mia
   has it and is told it isn't free. The story is the point: a whole-studio
   hire blocks every room, and one lamp can't be in two rooms. */

/* Steps: 0 empty · 1 Mia + kit · 2 Tom, whole studio · 3 Lena's kit is
   taken · 4 leave. */
const AT = [0, 1200, 3200, 5400, 9200] as const;
const PERIOD = 10000;
const S = { empty: 0, mia: 1, tom: 2, lena: 3, leave: 4 } as const;

const ROWS = ["Room A", "Room B", "Make-up room", "Profoto B10 kit"];
const HOURS = [8, 10, 12, 14, 16, 18];
/* The grid: one label column, then twelve hour columns (8:00 to 20:00);
   four rows. A block is placed by hour and row, so a whole-studio hire is
   one block spanning three rows. */
const FIRST_HOUR = 8;
const col = (h: number) => h - FIRST_HOUR + 2;

const BLOCK = "flex items-center overflow-hidden rounded-[10px] px-2.5 text-[12px] leading-none font-medium whitespace-nowrap transition-[opacity,transform] duration-[350ms] ease-strong motion-reduce:transition-none";
function Block({ on, from, to, row, rows = 1, tone, children }: { on: boolean; from: number; to: number; row: number; rows?: number; tone: "space" | "studio" | "taken"; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        BLOCK,
        on ? "opacity-100" : "scale-95 opacity-0",
        tone === "space" && "bg-kind-space-soft text-kind-space-text",
        tone === "studio" && "bg-brand text-white",
        tone === "taken" && "bg-danger-soft text-danger border-danger/40 border border-dashed",
      )}
      style={{ gridColumn: `${col(from)} / ${col(to)}`, gridRow: `${row} / ${row + rows}` }}
    >
      {children}
    </div>
  );
}

function Tape() {
  const step = useStoryLoop(AT, PERIOD, S.lena);
  const on = (s: number) => step >= s && step < S.leave;
  return (
    <div aria-hidden="true" className="bg-card ring-border relative w-full overflow-x-auto rounded-[24px] p-5 shadow-[var(--shadow-card)] ring-1 sm:p-6">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-[132px_repeat(12,1fr)] pb-2">
          <p className="text-foreground text-[14px] font-medium">Saturday, Oct 11</p>
          {HOURS.map((h) => (
            <span key={h} className="text-subtle font-mono text-[11px] tabular-nums" style={{ gridColumn: col(h) }}>
              {h}:00
            </span>
          ))}
        </div>
        <div className="relative grid grid-cols-[132px_repeat(12,1fr)] grid-rows-[repeat(4,44px)] gap-y-1.5">
          {/* the rows' grounds */}
          {ROWS.map((r, i) => (
            <div key={r} className="bg-secondary col-span-full flex items-center rounded-[12px] px-3" style={{ gridRow: i + 1 }}>
              <span className="text-foreground text-[13px] font-medium">{r}</span>
            </div>
          ))}
          <Block on={on(S.mia)} from={10} to={14} row={1} tone="space">
            Mia, Room A
          </Block>
          <Block on={on(S.mia)} from={10} to={14} row={4} tone="space">
            with Mia
          </Block>
          <Block on={on(S.tom)} from={15} to={19} row={1} rows={3} tone="studio">
            Tom, whole studio
          </Block>
          <Block on={on(S.lena)} from={12} to={15} row={2} tone="space">
            Lena, Room B
          </Block>
          {/* later in the DOM, so it paints over Mia's kit block */}
          <Block on={on(S.lena)} from={12} to={15} row={4} tone="taken">
            Kit not free
          </Block>
        </div>
      </div>
    </div>
  );
}

export function Compound() {
  return (
    <section aria-labelledby="compound-heading" className={cn(SECTION, "relative overflow-x-clip")}>
      <div className={SECTION_INNER}>
        <Reveal>
          <h2 id="compound-heading" className={H2}>
            {SECTIONS.compound.heading}
          </h2>
          <p className={LEAD}>{SECTIONS.compound.sub}</p>
        </Reveal>
        <Reveal delay={60} className="relative mt-12 md:mt-16">
          <BlobWash tone="space" className="top-[-30%] right-[-8%] w-[58%] rotate-[32deg]" />
          <BlobWash className="bottom-[-40%] left-[-12%] w-[44%] rotate-[-20deg] [animation-delay:-9s]" />
          <Tape />
        </Reveal>
      </div>
    </section>
  );
}
