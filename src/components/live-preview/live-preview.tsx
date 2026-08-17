"use client";

import * as React from "react";
import { BrowserFrame } from "./browser-frame";
import { DeviceToggle, type Device } from "./toggles";
import { cn } from "@/lib/utils";

/* Shared live-preview shell for the admin's in-context previews (Booking
   page, Website embed): title row with the caller's switches + a device
   toggle, a browser frame around the caller's page, and notices below.
   Owns the device state; the page column narrows to phone width on mobile. */
export function LivePreview({
  title = "Live preview",
  url,
  dark,
  controls,
  pageClassName,
  desktopMaxWidth = "max-w-[640px]",
  minHeight = "min-h-[560px]",
  notices,
  children,
}: {
  title?: string;
  url: string;
  /** Chrome scheme; should follow the previewed page's own surface. */
  dark: boolean;
  /** Extra toolbar switches, rendered before the device toggle. */
  controls?: React.ReactNode;
  /** Classes for the page ground inside the frame (background + text). */
  pageClassName: string;
  /** Tailwind max-width class for the page column at desktop. */
  desktopMaxWidth?: string;
  /** Tailwind min-height class for the page ground — kept tall even when
      the content is short, so the frame reads as a page, not a card. */
  minHeight?: string;
  notices?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [device, setDevice] = React.useState<Device>("desktop");
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm font-medium">{title}</p>
        <div className="flex items-center gap-2">
          {controls}
          <DeviceToggle value={device} onChange={setDevice} />
        </div>
      </div>
      <BrowserFrame url={url} dark={dark}>
        <div className={cn("flex justify-center px-6 py-8 transition-[background-color] sm:px-10", minHeight, pageClassName)}>
          <div
            className={cn(
              "flex w-full flex-col gap-6 transition-[max-width] duration-300",
              device === "mobile" ? "max-w-[360px]" : desktopMaxWidth,
            )}
          >
            {children}
          </div>
        </div>
      </BrowserFrame>
      {notices}
    </div>
  );
}
