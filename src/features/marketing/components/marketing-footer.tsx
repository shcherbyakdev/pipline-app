import Link from "next/link";
import { FOOTER_COLUMNS, SITE } from "@/features/marketing/site";
import { BookloLogo } from "./booklo-mark";

/* The logo, the link columns, one quiet line at the bottom. Part of the
   landing's dark closing block: the footer shares the CTA band's `.dark`
   scope so the page ends on the ink ground. */
export function MarketingFooter() {
  return (
    <footer className="dark bg-background border-border border-t">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
        <div className="grid gap-10 py-12 md:grid-cols-[1.6fr_repeat(3,1fr)] md:py-14">
          <div>
            <p className="text-foreground text-[24px]">
              <BookloLogo />
            </p>
            <p className="text-muted-foreground mt-3.5 max-w-[26rem] text-[14px] leading-relaxed">{SITE.tagline}</p>
          </div>
          {FOOTER_COLUMNS.map((col) => (
            <div key={col.heading}>
              <p className="text-foreground text-[13.5px] font-medium">{col.heading}</p>
              <ul className="mt-3 space-y-2 text-[14px]">
                {col.links.map((l) => (
                  <li key={l.label}>
                    {l.href.startsWith("#") ? (
                      <a href={l.href} className="text-muted-foreground hover:text-foreground transition-colors duration-150">
                        {l.label}
                      </a>
                    ) : (
                      <Link href={l.href} className="text-muted-foreground hover:text-foreground transition-colors duration-150">
                        {l.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="text-subtle border-border border-t py-5 text-[13px]">© 2026 {SITE.name}</p>
      </div>
    </footer>
  );
}
