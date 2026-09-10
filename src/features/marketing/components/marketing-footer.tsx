import Link from "next/link";
import { FOOTER_LINKS, SITE } from "@/features/marketing/site";

/* One quiet line: the year and the name, then the links and the address to
   write to. */
const link =
  "text-muted-foreground hover:text-foreground focus-visible:ring-ring -mx-1 inline-flex min-h-8 items-center rounded-md px-1 transition-colors duration-150 outline-none focus-visible:ring-2";

export function MarketingFooter() {
  return (
    <footer className="border-border mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t px-5 py-8 text-[14px] sm:px-8">
      <p className="text-subtle">© 2026 {SITE.name}</p>
      <ul className="flex flex-wrap gap-5">
        {FOOTER_LINKS.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className={link}>
              {l.label}
            </Link>
          </li>
        ))}
        <li>
          <a href={`mailto:${SITE.supportEmail}`} className={link}>
            {SITE.supportEmail}
          </a>
        </li>
      </ul>
    </footer>
  );
}
