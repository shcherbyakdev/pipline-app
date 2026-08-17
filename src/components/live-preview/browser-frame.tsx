"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/* Mock browser window for in-context previews (Booking page, Website embed).
   Neutral greys on purpose — not our tokens — so the chrome reads as "a
   browser", not part of the admin, in either admin theme. `dark` picks the
   chrome's own light/dark look; what's inside is the caller's page. */
export function BrowserFrame({
  url,
  dark,
  children,
  className,
}: {
  url: string;
  dark: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border shadow-[0_24px_60px_-28px_oklch(0_0_0/60%)]",
        dark ? "border-white/10 bg-[#111214]" : "border-black/10 bg-white",
        className,
      )}
    >
      <div
        className={cn(
          "flex h-10 items-center gap-3 border-b px-3",
          dark ? "border-white/10 bg-[#18191c]" : "border-black/8 bg-[#f4f4f5]",
        )}
      >
        <div className="flex gap-1.5" aria-hidden="true">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
        </div>
        <div
          className={cn(
            "mx-auto flex h-6 w-full max-w-xs items-center justify-center truncate rounded-md px-3 font-mono text-[11px]",
            dark ? "bg-white/8 text-white/50" : "bg-black/6 text-black/45",
          )}
        >
          <span className="truncate">{url}</span>
        </div>
        <span className="w-12" aria-hidden="true" />
      </div>
      {children}
    </div>
  );
}
