import { initials } from "@/features/scheduling/staff-slug";
import { bookingPath } from "@/lib/booking/url";
import { cn } from "@/lib/utils";
import type { SectionOf } from "../../schema";
import type { RenderContext } from "../context";
import { Ghost } from "../ghost";
import { H2, PICK_CARD } from "../type";

const CARD = cn(PICK_CARD, "flex flex-col items-center gap-3 p-5 text-center");

export function StaffSection({ section, ctx }: { section: SectionOf<"staff">; ctx: RenderContext }) {
  if (ctx.lockedStaff) return null;
  if (ctx.staff.length < 2) return <Ghost ctx={ctx} text="staff" />;
  return (
    <section className="flex flex-col gap-5">
      {section.title.trim() ? <h2 className={H2}>{section.title}</h2> : null}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {ctx.staff.map((p) => {
          const body = (
            <>
              {/* `wt-round`: the widget theme squares every `rounded`; this stays a disc. */}
              <span aria-hidden className="wt-round flex size-14 items-center justify-center rounded-full text-base font-semibold text-white" style={{ background: p.color }}>
                {initials(p.name)}
              </span>
              <span className="text-sm font-medium">{p.name}</span>
            </>
          );
          return (
            <li key={p.id}>
              {ctx.mode === "preview" ? <div className={CARD}>{body}</div> : <a href={bookingPath(ctx.org.handle, p.slug)} className={CARD}>{body}</a>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
