"use client";

import * as React from "react";
import { ThemeProvider } from "next-themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { CommandMenu } from "@/components/command-menu";
import type { Flags } from "@/lib/flags";
import { navItemsFor } from "@/components/shell/nav";

export function Providers({ flags, children }: { flags: Flags; children: React.ReactNode }) {
  const [queryClient] = React.useState(() => new QueryClient());
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        {children}
        {/* Mounted only when the org's `command_menu` flag resolves true, so ⌘K never binds otherwise. */}
        {flags.command_menu && <CommandMenu items={navItemsFor(flags)} />}
        <Toaster />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
