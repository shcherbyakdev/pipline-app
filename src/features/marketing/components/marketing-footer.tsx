import Link from "next/link";
import { FOOTER_LINKS, SITE } from "@/features/marketing/site";

/* One quiet line: the year and the name, then the three links. */
export function MarketingFooter() {
  return (
    <footer className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-8 text-[13px] sm:px-8">
      <p className="text-subtle">© 2026 {SITE.name}</p>
      <ul className="flex gap-5">
        {FOOTER_LINKS.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="text-muted-foreground hover:text-foreground transition-colors duration-150">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </footer>
  );
}
