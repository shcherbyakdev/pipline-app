import { initials } from "@/features/scheduling/staff-slug";
import { bookingPath } from "@/lib/booking/url";
import type { SectionOf } from "../../schema";
import type { RenderContext } from "../context";
import { Ghost } from "../ghost";

const CARD = "wt-surface flex flex-col items-center gap-2 rounded-[var(--widget-radius)] border p-4 text-center";

export function StaffSection({ section, ctx }: { section: SectionOf<"staff">; ctx: RenderContext }) {
  if (ctx.lockedStaff) return null;
  if (ctx.staff.length < 2) return <Ghost mode={ctx.mode} label="Shows once two or more team members are bookable" />;
  return (
    <section className="flex flex-col gap-3">
      {section.title.trim() ? <h2 className="text-xl font-semibold tracking-tight">{section.title}</h2> : null}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {ctx.staff.map((p) => {
          const body = (
            <>
              <span aria-hidden className="flex size-12 items-center justify-center rounded-full text-sm font-semibold text-white" style={{ background: p.color }}>
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
