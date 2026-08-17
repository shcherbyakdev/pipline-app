"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/* Settings sub-navigation. Route-based tabs (Linear settings pattern) so each
   area is linkable and loads only what it needs. Order: what you configure
   for clients first, the widget you put on your own site next, then how the
   admin looks to you. */
export const SETTINGS_TABS = [
  { href: "/settings", label: "General" },
  { href: "/settings/widget", label: "Widget & embed" },
  { href: "/settings/appearance", label: "Appearance" },
] as const;

export function SettingsTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings sections" className="-mb-px flex gap-1 border-b">
      {SETTINGS_TABS.map(({ href, label }) => {
        const active = href === "/settings" ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px flex h-9 items-center border-b-2 px-3 text-[13px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              active
                ? "border-foreground text-foreground"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
