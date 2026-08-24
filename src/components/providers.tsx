"use client";

import * as React from "react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { CommandMenu } from "@/components/command-menu";
import type { Flags } from "@/lib/flags";
import { navItemsFor } from "@/components/shell/nav";

// No data-fetching provider: reads are server components and writes are
// server actions, so the @tanstack/react-query client this once mounted had
// no consumer (removed in the 2026-08-24 audit).
export function Providers({ flags, children }: { flags: Flags; children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
      {children}
      {/* Mounted only when the org's `command_menu` flag resolves true, so ⌘K never binds otherwise. */}
      {flags.command_menu && <CommandMenu items={navItemsFor(flags)} />}
      <Toaster />
    </ThemeProvider>
  );
}
