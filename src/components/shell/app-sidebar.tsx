"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "./nav";
import { signOut } from "@/features/auth/actions";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

export function AppSidebar({ org, userEmail }: { org: string; userEmail: string }) {
  const pathname = usePathname();
  return (
    <aside className="bg-sidebar text-sidebar-foreground hidden w-56 shrink-0 flex-col border-r md:flex">
      <div className="flex h-12 items-center px-4 text-sm font-semibold">{org}</div>
      <nav className="flex-1 space-y-0.5 px-2 py-2">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
        <span className="text-muted-foreground truncate text-xs">{userEmail}</span>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <form action={signOut}>
            <button type="submit" className="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
