"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { Logout03Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { NAV_ITEMS, NAV_SECTION_LABELS } from "./nav";
import { signOut } from "@/features/auth/actions";
import { OPEN_COMMAND_MENU_EVENT } from "@/components/command-menu";
import { cn } from "@/lib/utils";

/* Linear sidebar metrics: 13px/500 items, 16px icons, 4px radius, ~27px rows,
   selected = white-alpha fill (no accent tint), section labels 12px muted. */
const itemClass =
  "flex h-7 w-full items-center gap-2.5 rounded-[4px] px-2 text-[13px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50";
const idleClass = "text-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground";
const activeClass = "bg-[oklch(1_0_0/9%)] text-sidebar-foreground";

export function SidebarBody({
  org,
  userEmail,
  onNavigate,
}: {
  org: string;
  userEmail: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const initial = (org.trim()[0] ?? userEmail[0] ?? "?").toUpperCase();
  const sections = ["main", "configure"] as const;

  return (
    <div className="flex h-full flex-col px-4 py-3">
      {/* Workspace row: initial tile in the accent (Linear's mustard tile) + org name. */}
      <div className="flex h-8 items-center pr-8 md:pr-0">
        <div className="flex min-w-0 items-center gap-2 px-1.5">
          <span
            aria-hidden="true"
            className="bg-primary text-primary-foreground flex size-[18px] shrink-0 items-center justify-center rounded-[4px] text-[11px] font-semibold"
          >
            {initial}
          </span>
          <span className="truncate text-[13px] font-medium">{org}</span>
        </div>
      </div>

      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event(OPEN_COMMAND_MENU_EVENT))}
        className="bg-secondary text-foreground/80 hover:text-foreground focus-visible:ring-ring/50 mt-3 flex h-7 w-full items-center gap-2.5 rounded-[4px] border px-1.5 text-[13px] shadow-[0_1px_0.5px_oklch(0_0_0/15%)] outline-none focus-visible:ring-2"
      >
        <HugeiconsIcon icon={Search01Icon} size={16} className="shrink-0" />
        <span className="flex-1 text-left">Search</span>
        <kbd className="text-muted-foreground font-mono text-[10px]">⌘K</kbd>
      </button>

      <nav aria-label="Workspace" className="mt-4 flex flex-col gap-4">
        {sections.map((section) => {
          const items = NAV_ITEMS.filter((i) => i.section === section);
          const label = NAV_SECTION_LABELS[section];
          return (
            <div key={section} className="flex flex-col gap-px">
              {label && (
                <div className="text-muted-foreground flex h-7 items-center px-2 text-xs font-medium">{label}</div>
              )}
              {items.map(({ href, label: text, icon }) => {
                const active = isActive(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(itemClass, active ? activeClass : idleClass)}
                  >
                    <HugeiconsIcon icon={icon} size={16} className="shrink-0" />
                    {text}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-1 pt-4">
        <div className="text-muted-foreground truncate px-2 text-xs" title={userEmail}>
          {userEmail}
        </div>
        <form action={signOut}>
          <button
            type="submit"
            className="text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-ring/50 flex h-7 w-full items-center gap-2 rounded-[4px] px-2 text-xs outline-none focus-visible:ring-2"
          >
            <HugeiconsIcon icon={Logout03Icon} size={14} />
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
