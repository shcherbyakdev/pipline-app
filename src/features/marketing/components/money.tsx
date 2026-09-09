"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { RULES, SECTIONS } from "@/features/marketing/site";
import { cn } from "@/lib/utils";
import { Reveal } from "./reveal";
import { useStoryLoop } from "./story-loop";
import { H2, LEAD, PANEL } from "./type";

/* The money spine, on the landing's dark panel: a centred heading, then one
   booking's money record telling its own story (priced, held, paid, moved,
   overtime, balance, collected: every line lands on the same record), then
   the three rules that produced it as cards with the studio's terms as
   chips. The panel opts into the `.dark` token scope and carries
   `data-nav-dark`, so the sticky nav inverts while over it. */

/* Story steps: 0 priced · 1 held · 2 paid · 3 moved · 4 overtime · 5 balance
   · 6 collected · 7 leave. */
const AT = [0, 1400, 2600, 3900, 5100, 6200, 7400, 10400] as const;
const PERIOD = 11200;
const S = { priced: 0, held: 1, paid: 2, moved: 3, overtime: 4, balance: 5, collected: 6, leave: 7 } as const;

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
function Amount({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return <span className={cn("shrink-0 font-mono text-[13px] tabular-nums", muted ? "text-muted-foreground" : "text-foreground")}>{children}</span>;
}

function Record() {
  const step = useStoryLoop(AT, PERIOD, S.collected);
  const on = (s: number) => step >= s && step < S.leave;
  const settled = on(S.collected);
  return (
    <div
      aria-hidden="true"
      className={cn(
        "bg-card ring-border mx-auto w-full max-w-2xl rounded-[24px] p-6 text-left shadow-[var(--shadow-card)] ring-1 transition-opacity duration-500 ease-strong motion-reduce:transition-none sm:p-7",
        step === S.leave ? "opacity-0" : "opacity-100",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-foreground text-[16px] font-medium">Mia Novak</p>
          <p className="text-muted-foreground mt-0.5 text-[13px]">Room A, Sat 11 Oct, 10:00 to 14:00</p>
        </div>
        <Chip tone={settled ? "done" : on(S.paid) ? "done" : on(S.held) ? "wait" : "note"}>{settled ? "Settled" : on(S.paid) ? "Confirmed" : on(S.held) ? "Held" : "Priced"}</Chip>
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
  return (
    <section
      aria-labelledby="money-heading"
      data-nav-dark
      className={cn(PANEL, "dark bg-background mt-3 overflow-hidden py-16 sm:mt-5 sm:py-20 md:py-24")}
    >
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 id="money-heading" className={H2}>
            {SECTIONS.money.heading}
          </h2>
          <p className={cn(LEAD, "mx-auto max-w-xl")}>{SECTIONS.money.sub}</p>
        </Reveal>

        <Reveal delay={60} className="mt-12 md:mt-14">
          <Record />
        </Reveal>

        <ul className="mt-12 grid gap-4 md:mt-16 md:grid-cols-3">
          {RULES.map((r, i) => (
            <Reveal as="li" key={r.title} delay={i * 70} className="bg-card ring-border flex flex-col rounded-[24px] p-6 ring-1 sm:p-7">
              <h3 className="text-foreground text-[19px] leading-snug font-medium tracking-[-0.01em]">{r.title}</h3>
              <p className="text-muted-foreground mt-2 pb-6 text-[15px] leading-relaxed">{r.body}</p>
              <ul className="border-border mt-auto flex flex-wrap gap-2 border-t pt-5">
                {r.chips.map((c) => (
                  <li key={c} className="bg-secondary text-foreground rounded-full px-3 py-1.5 text-[13px] leading-none font-medium">
                    {c}
                  </li>
                ))}
              </ul>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
