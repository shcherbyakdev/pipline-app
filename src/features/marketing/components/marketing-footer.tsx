import Link from "next/link";
import { FOOTER_COLUMNS, SITE } from "@/features/marketing/site";
import { BookloWordmark } from "./booklo-mark";

/* Continues the final CTA's ink ground (`.ink`, globals.css). */
export function MarketingFooter() {
  return (
    <footer className="ink bg-background text-foreground">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
        <div className="border-border grid gap-10 border-t py-14 md:grid-cols-[1.5fr_repeat(3,1fr)] md:py-16">
          <div>
            <p className="text-lg">
              <BookloWordmark />
            </p>
            <p className="text-muted-foreground mt-3 max-w-xs text-sm leading-relaxed">{SITE.tagline}</p>
          </div>
          {FOOTER_COLUMNS.map((col) => (
            <div key={col.heading}>
              <p className="text-muted-foreground font-mono text-[11px] tracking-[0.14em] uppercase">{col.heading}</p>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    {l.href.startsWith("#") ? (
                      <a href={l.href} className="text-foreground/80 hover:text-foreground text-sm transition-colors duration-200">
                        {l.label}
                      </a>
                    ) : (
                      <Link href={l.href} className="text-foreground/80 hover:text-foreground text-sm transition-colors duration-200">
                        {l.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="text-muted-foreground border-border border-t py-8 text-xs">© 2026 {SITE.name}</p>
      </div>
    </footer>
  );
}
