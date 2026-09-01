"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/* Mock device window for in-context previews (Booking page, Website embed).
   Neutral greys on purpose — not our tokens — so the chrome reads as "a
   browser" (or "a phone"), not part of the admin, in either admin theme.
   `dark` picks the chrome's own light/dark look; what's inside is the
   caller's page. `device="mobile"` swaps the browser window for a phone
   bezel with a status-bar island and home indicator; the header/footer are
   siblings of `children`, which keeps the page subtree mounted across a
   device toggle. */
export function BrowserFrame({
  url,
  dark,
  device = "desktop",
  children,
  className,
}: {
  url: string;
  dark: boolean;
  device?: "desktop" | "mobile";
  children: React.ReactNode;
  className?: string;
}) {
  const mobile = device === "mobile";
  return (
    <div
      className={cn(
        "overflow-hidden shadow-[0_24px_60px_-28px_oklch(0_0_0/60%)] transition-[width,border-radius] duration-300",
        mobile
          ? "mx-auto w-[390px] max-w-full rounded-[2.75rem] border-8 border-[#17181a] bg-[#17181a]"
          : cn("rounded-xl border", dark ? "border-white/10 bg-[#111214]" : "border-black/10 bg-white"),
        className,
      )}
    >
      {mobile ? (
        <div
          className={cn(
            "flex h-9 items-center justify-center rounded-t-[2.25rem]",
            dark ? "bg-[#18191c]" : "bg-[#f4f4f5]",
          )}
          aria-hidden="true"
        >
          <span className="h-5 w-24 rounded-full bg-[#17181a]" />
        </div>
      ) : (
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
              dark ? "bg-white/8 text-white/70" : "bg-black/6 text-black/60",
            )}
          >
            <span className="truncate">{url}</span>
          </div>
          <span className="w-12" aria-hidden="true" />
        </div>
      )}
      {children}
      {mobile ? (
        <div
          className={cn("flex h-7 items-center justify-center rounded-b-[2.25rem]", dark ? "bg-[#18191c]" : "bg-[#f4f4f5]")}
          aria-hidden="true"
        >
          <span className={cn("h-1 w-28 rounded-full", dark ? "bg-white/30" : "bg-black/25")} />
        </div>
      ) : null}
    </div>
  );
}
