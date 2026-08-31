"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { Logout03Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { navItemsFor, NAV_SECTIONS, NAV_SECTION_LABELS } from "./nav";
import type { Flags } from "@/lib/flags";
import type { OrgMode } from "@/features/orgs/mode";
import { signOut } from "@/features/auth/actions";
import { OPEN_COMMAND_MENU_EVENT } from "@/components/command-menu";
import { cn } from "@/lib/utils";

/* Soft-world sidebar: a warm grey panel one step off the ground, 13px/500
   rows on 8px radii, and the active row lifted onto a white card (hairline
   + the small layered shadow) instead of an accent tint — the same move the
   landing's booking card uses for its selected row. */
const itemClass =
  "flex h-8 w-full items-center gap-2.5 rounded-lg border border-transparent px-2.5 text-[13px] font-medium transition-colors duration-150 ease-strong outline-none focus-visible:ring-2 focus-visible:ring-ring/40";
const idleClass = "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground";
const activeClass = "border-border bg-card text-foreground shadow-(--shadow-lift)";

export function SidebarBody({
  org,
  userEmail,
  flags,
  mode,
  pendingRequests,
  onNavigate,
}: {
  org: string;
  userEmail: string;
  flags: Flags;
  mode: OrgMode;
  /** Live booking requests; badges the Overview row. 0 hides the badge —
      and is what the layout passes whenever the overview flag is off. */
  pendingRequests: number;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const initial = (org.trim()[0] ?? userEmail[0] ?? "?").toUpperCase();
  const sections = NAV_SECTIONS;
  const navItems = navItemsFor(flags, mode);

  return (
    <div className="flex h-full flex-col px-3 py-4">
      {/* Workspace row: the org's initial on an ink tile + the org name. */}
      <div className="flex h-9 items-center pr-8 md:pr-0">
        <div className="flex min-w-0 items-center gap-2.5 px-1.5">
          <span
            aria-hidden="true"
            className="bg-primary text-primary-foreground flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold"
          >
            {initial}
          </span>
          <span className="truncate text-[13.5px] font-semibold tracking-[-0.01em]">{org}</span>
        </div>
      </div>

      {/* Shown only when the org's `command_menu` flag resolves true (lib/flags). */}
      {flags.command_menu && (
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event(OPEN_COMMAND_MENU_EVENT))}
          className="bg-card text-muted-foreground hover:text-foreground focus-visible:ring-ring/40 mt-4 flex h-8 w-full items-center gap-2.5 rounded-full border px-3 text-[13px] shadow-(--shadow-lift) transition-colors duration-150 ease-strong outline-none focus-visible:ring-2"
        >
          <HugeiconsIcon icon={Search01Icon} size={15} className="shrink-0" />
          <span className="flex-1 text-left">Search</span>
          <kbd className="text-subtle font-mono text-[10px]">⌘K</kbd>
        </button>
      )}

      <nav aria-label="Workspace" className="mt-5 flex flex-col gap-5">
        {sections.map((section) => {
          const items = navItems.filter((i) => i.section === section);
          const label = NAV_SECTION_LABELS[section];
          return (
            <div key={section} className="flex flex-col gap-0.5">
              {label && (
                <div className="text-subtle flex h-6 items-center px-2.5 text-xs font-medium">{label}</div>
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
                    <HugeiconsIcon icon={icon} size={16} className={cn("shrink-0", active ? "text-brand-text" : "text-subtle")} />
                    {text}
                    {/* Booking requests waiting. The bare number would be
                        read out as "Overview 3", so the noun rides along
                        for screen readers. */}
                    {href === "/overview" && pendingRequests > 0 ? (
                      <span className="bg-primary/10 text-primary ml-auto rounded-full px-1.5 text-xs font-medium tabular-nums">
                        {pendingRequests}
                        <span className="sr-only">
                          {pendingRequests === 1 ? " request waiting" : " requests waiting"}
                        </span>
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-1 pt-4">
        <div className="text-subtle truncate px-2.5 text-xs" title={userEmail}>
          {userEmail}
        </div>
        <form action={signOut}>
          <button
            type="submit"
            className="text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-ring/40 flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors duration-150 ease-strong outline-none focus-visible:ring-2"
          >
            <HugeiconsIcon icon={Logout03Icon} size={15} className="text-subtle" />
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
