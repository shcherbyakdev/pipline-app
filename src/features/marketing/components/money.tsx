"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { MONEY_STEPS, SECTIONS } from "@/features/marketing/site";
import { cn } from "@/lib/utils";
import { Reveal } from "./reveal";
import { H2, LEAD, SECTION, SECTION_INNER } from "./type";

/* The money spine, told by scrolling: the seven beats of one booking run
   down the left as short paragraphs; the record on the right is sticky
   and fills in as each beat crosses the middle of the viewport (priced,
   held, paid, moved, overtime, balance, collected). The reader sets the
   pace, so nothing loops and nothing plays while they are not looking.
   The record is the one ink surface on the page: it opts into the `.dark`
   token scope on its own. Sample booking; every name and price is
   fictional. Below md the record sits above the beats, still sticky. */

const S = { priced: 0, held: 1, paid: 2, moved: 3, overtime: 4, balance: 5, collected: 6 } as const;

/* Which beat is "current": the one whose block crosses a band around the
   viewport's middle (rootMargin trims the root to that band). The observer
   is the only scroll listener; it fires per crossing, not per frame. */
function useScrollBeat(count: number) {
  const refs = React.useRef<(HTMLElement | null)[]>([]);
  const [beat, setBeat] = React.useState(0);
  React.useEffect(() => {
    const els = refs.current.filter((el): el is HTMLElement => el !== null);
    if (els.length === 0 || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          setBeat(Number((e.target as HTMLElement).dataset.beat));
        }
      },
      { rootMargin: "-42% 0px -42% 0px", threshold: 0 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [count]);
  const register = (i: number) => (el: HTMLElement | null) => {
    refs.current[i] = el;
  };
  return { beat, register };
}

const ROW = "flex items-center justify-between gap-4 transition-[opacity,transform] duration-300 ease-strong motion-reduce:transition-none";
function Row({ on, children, className }: { on: boolean; children: React.ReactNode; className?: string }) {
  return <div className={cn(ROW, on ? "opacity-100" : "translate-y-1 opacity-0", className)}>{children}</div>;
}
function Chip({ tone, children }: { tone: "wait" | "done" | "note"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2.5 text-[12px] font-medium transition-[background-color,color] duration-300 ease-strong motion-reduce:transition-none",
        tone === "done" && "bg-kind-space-soft text-kind-space-text",
        tone === "wait" && "bg-kind-stay-soft text-kind-stay-text",
        tone === "note" && "bg-secondary text-muted-foreground",
      )}
    >
      {tone === "done" ? <Check className="size-3" strokeWidth={3} /> : null}
      {children}
    </span>
  );
}
function Amount({ children }: { children: React.ReactNode }) {
  return <span className="text-foreground shrink-0 font-mono text-[13px] tabular-nums">{children}</span>;
}

function Record({ beat }: { beat: number }) {
  const on = (s: number) => beat >= s;
  const settled = on(S.collected);
  return (
    <div aria-hidden="true" className="dark bg-card text-card-foreground w-full rounded-[24px] p-6 text-left shadow-[var(--shadow-card)] sm:p-7">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-foreground text-[16px] font-medium">Mia Novak</p>
          <p className="text-muted-foreground mt-0.5 text-[13px]">Room A, Sat 11 Oct, 10:00 to 14:00</p>
        </div>
        <Chip tone={settled || on(S.paid) ? "done" : on(S.held) ? "wait" : "note"}>{settled ? "Settled" : on(S.paid) ? "Confirmed" : on(S.held) ? "Held" : "Priced"}</Chip>
      </div>

      <div className="mt-5 flex flex-col gap-2.5 text-[14px]">
        <Row on className="text-muted-foreground">
          <span>Room A, 4 h, 2 h+ tier</span>
          <Amount>560 zł</Amount>
        </Row>
        <Row on className="text-muted-foreground">
          <span>Profoto B10 kit, 4 h</span>
          <Amount>200 zł</Amount>
        </Row>
        <Row on={on(S.held)} className="text-muted-foreground">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate">Deposit 30%, pay by 16:40</span>
            <Chip tone={on(S.paid) ? "done" : "wait"}>{on(S.paid) ? "Paid" : "Held"}</Chip>
          </span>
          <Amount>228 zł</Amount>
        </Row>
        <Row on={on(S.moved)} className="text-muted-foreground">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate">Moved to Sun 12, 30 h notice</span>
            <Chip tone="note">48 h tier</Chip>
          </span>
          <Amount>+40 zł</Amount>
        </Row>
        <Row on={on(S.overtime)} className="text-muted-foreground">
          <span>Overtime, 30 min</span>
          <Amount>+70 zł</Amount>
        </Row>
        <Row on={on(S.balance)} className="border-border text-foreground border-t pt-2.5 font-medium">
          <span className="flex min-w-0 items-center gap-2">
            <span>Balance</span>
            <Chip tone={on(S.collected) ? "done" : "wait"}>{on(S.collected) ? "Collected" : "Link sent"}</Chip>
          </span>
          <Amount>642 zł</Amount>
        </Row>
      </div>
    </div>
  );
}

export function Money() {
  const { beat, register } = useScrollBeat(MONEY_STEPS.length);
  return (
    <section aria-labelledby="money-heading" className={SECTION}>
      <div className={SECTION_INNER}>
        <Reveal>
          <h2 id="money-heading" className={H2}>
            {SECTIONS.money.heading}
          </h2>
          <p className={LEAD}>{SECTIONS.money.sub}</p>
        </Reveal>

        <div className="mt-12 grid gap-10 md:mt-16 md:grid-cols-[1fr_1.15fr] md:gap-16 lg:gap-24">
          <div className="sticky top-24 z-10 self-start md:order-2 md:top-28">
            <Record beat={beat} />
          </div>
          <ol className="md:order-1">
            {MONEY_STEPS.map((m, i) => {
              const active = i === beat;
              return (
                <li
                  key={m.title}
                  ref={register(i)}
                  data-beat={i}
                  className={cn(
                    "border-border flex flex-col justify-center border-t py-8 transition-opacity duration-300 ease-strong motion-reduce:transition-none md:min-h-[28vh] md:py-10",
                    active ? "opacity-100" : "opacity-45",
                  )}
                >
                  <p className="text-brand-text font-mono text-[13px] tabular-nums">0{i + 1}</p>
                  <h3 className="text-foreground mt-2 text-[24px] leading-tight font-medium tracking-[-0.02em]">{m.title}</h3>
                  <p className="text-muted-foreground mt-2 max-w-[30rem] text-[16px] leading-relaxed">{m.body}</p>
                  {m.chips ? (
                    <ul className="mt-4 flex flex-wrap gap-2">
                      {m.chips.map((c) => (
                        <li key={c} className="bg-secondary text-foreground rounded-full px-3 py-1.5 text-[13px] leading-none font-medium">
                          {c}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}
