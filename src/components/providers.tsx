"use client";

import * as React from "react";
import { ThemeProvider } from "next-themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { CommandMenu } from "@/components/command-menu";
import { COMMAND_MENU_ENABLED } from "@/lib/flags";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(() => new QueryClient());
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        {children}
        {/* Parked (see lib/flags.ts) — unmounted so ⌘K never binds. */}
        {COMMAND_MENU_ENABLED && <CommandMenu />}
        <Toaster />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
