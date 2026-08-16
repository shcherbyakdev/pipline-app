import Link from "next/link";
import { FOOTER_COLUMNS, SITE } from "@/features/marketing/site";

export function MarketingFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-6 py-16 md:grid-cols-[1.5fr_repeat(3,1fr)]">
        <div>
          <p className="text-lg font-semibold tracking-tight">{SITE.name}</p>
          <p className="text-muted-foreground mt-2 max-w-xs text-sm">{SITE.tagline}</p>
        </div>
        {FOOTER_COLUMNS.map((col) => (
          <div key={col.heading}>
            <p className="text-sm font-medium">{col.heading}</p>
            <ul className="mt-3 space-y-2">
              {col.links.map((l) => (
                <li key={l.label}>
                  {l.href.startsWith("#") ? (
                    <a href={l.href} className="text-muted-foreground hover:text-foreground text-sm">{l.label}</a>
                  ) : (
                    <Link href={l.href} className="text-muted-foreground hover:text-foreground text-sm">{l.label}</Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto w-full max-w-6xl px-6 pb-8">
        <p className="text-muted-foreground text-xs">© 2026 {SITE.name}</p>
      </div>
    </footer>
  );
}
