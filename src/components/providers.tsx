"use client";

import * as React from "react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { CommandMenu } from "@/components/command-menu";
import type { Flags } from "@/lib/flags";
import { navItemsFor } from "@/components/shell/nav";
import { effectiveMode, type OrgMode } from "@/features/orgs/mode";

// No data-fetching provider: reads are server components and writes are
// server actions, so the @tanstack/react-query client this once mounted had
// no consumer (removed in the 2026-08-24 audit).
export function Providers({ flags, mode, children }: { flags: Flags; mode: OrgMode; children: React.ReactNode }) {
  // The command menu's own "New rental offering" action (command-menu.tsx)
  // reads `mode.offersRentals` directly with no flag check of its own, so it
  // must be handed the effective mode — otherwise the kill switch stops
  // gating the nav (navItemsFor, below) but not ⌘K's actions.
  const eff = effectiveMode(flags, mode);
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
      {children}
      {/* Mounted only when the org's `command_menu` flag resolves true, so ⌘K never binds otherwise. */}
      {flags.command_menu && <CommandMenu items={navItemsFor(flags, mode)} mode={eff} />}
      <Toaster />
    </ThemeProvider>
  );
}
