"use client";

import { initials } from "@/features/scheduling/staff-slug";
import { cn } from "@/lib/utils";
import type { SectionOf } from "../../schema";
import type { RenderContext } from "../context";
import { Ghost } from "../ghost";
import { usePageState } from "../page-state";
import { H2, PICK_CARD } from "../type";

const CARD = cn(PICK_CARD, "flex w-full flex-col items-center gap-3 p-5 text-center");

/* The team, as the page's person picker (2026-09-04): picking someone narrows
   the widget below to what they do and keeps them through the booking; picking
   them again clears back to anyone. One picker per page, so the widget drops
   its own person switch while this section is on it (pickers.ts). */
export function StaffSection({ section, ctx }: { section: SectionOf<"staff">; ctx: RenderContext }) {
  const { staffPick, selectStaff } = usePageState();
  if (ctx.lockedStaff) return null;
  if (ctx.staff.length < 2) return <Ghost ctx={ctx} text="staff" />;
  const picked = staffPick?.id ?? null;
  const pick = (id: string) => {
    selectStaff(id);
    // The preview sits inside the admin page: no scrolling there.
    if (ctx.mode === "public") document.getElementById("book")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <section id="team" className="flex scroll-mt-6 flex-col gap-5">
      {section.title.trim() ? <h2 className={H2}>{section.title}</h2> : null}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {ctx.staff.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => pick(p.id)} aria-pressed={p.id === picked} className={cn(CARD, "aria-pressed:bg-muted")}>
              {/* `wt-round`: the widget theme squares every `rounded`; this stays a disc. */}
              <span aria-hidden className="wt-round flex size-14 items-center justify-center rounded-full text-base font-semibold text-white" style={{ background: p.color }}>
                {initials(p.name)}
              </span>
              <span className="text-sm font-medium">{p.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
