import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils";

/* The reference's dot row: 8px dots, the active one stretched into a 24px
   gradient pill. The morph is a width + opacity transition (200ms, house
   curve) — a 16px layout delta contained to this row, where a transform
   would distort the dot's radius and FLIP would be five elements of
   ceremony. Inactive dots dim with distance ahead of the active one and
   settle at 0.6 behind it, like the reference. Dots with an `href` (the
   post-org steps) are links; the rest are markers. Reduced motion keeps
   the opacity change and snaps the width. */
export async function WizardStepper({
  count,
  active,
  hrefs,
}: {
  count: number;
  active: number;
  /** Per-dot destination (index-aligned), null for inert dots. */
  hrefs?: ReadonlyArray<{ href: string; label: string } | null>;
}) {
  const t = await getTranslations("onboarding");
  const dots = Array.from({ length: count }, (_, i) => {
    const isActive = i === active;
    const opacity = isActive ? 1 : i < active ? 0.6 : Math.max(0.45, 0.85 - 0.15 * (i - active - 1));
    const dot = (
      <span
        className={cn(
          "bg-muted-foreground relative block h-2 rounded-full transition-[width,opacity] duration-200 ease-strong motion-reduce:transition-opacity",
          isActive ? "w-6" : "w-2",
        )}
        style={{ opacity }}
      >
        <span
          aria-hidden
          className="bg-linear-to-r from-foreground to-muted-foreground absolute inset-0 rounded-full transition-opacity duration-200 ease-strong"
          style={{ opacity: isActive ? 1 : 0 }}
        />
      </span>
    );
    const link = hrefs?.[i];
    return link ? (
      <Link
        key={i}
        href={link.href}
        aria-label={link.label}
        aria-current={isActive ? "step" : undefined}
        className="focus-visible:ring-ring rounded-full p-1 outline-none focus-visible:ring-2"
      >
        {dot}
      </Link>
    ) : (
      <span key={i} className="p-1" aria-current={isActive ? "step" : undefined}>
        {dot}
      </span>
    );
  });

  return (
    <nav aria-label={t("stepOf", { step: active + 1, count })} className="flex items-center justify-center gap-1 pb-6">
      {dots}
    </nav>
  );
}
