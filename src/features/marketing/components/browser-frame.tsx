"use client";

import * as React from "react";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

/* Renders children at a fixed design width and scales the whole block down
   to its container with transform: scale() (spec §3.6). The outer height is
   set from the inner's measured height × scale so layout below never
   overflows. SSR renders at scale 1; the first ResizeObserver tick corrects
   it (hidden by the hero-rise animation). */
export function ScaledFrame({
  designWidth = 896,
  children,
  className,
}: {
  designWidth?: number;
  children: React.ReactNode;
  className?: string;
}) {
  const outer = React.useRef<HTMLDivElement>(null);
  const inner = React.useRef<HTMLDivElement>(null);
  const [scale, setScale] = React.useState(1);
  const [height, setHeight] = React.useState<number | undefined>(undefined);

  React.useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const measure = () => {
      const s = Math.min(1, o.clientWidth / designWidth);
      setScale(s);
      setHeight(i.offsetHeight * s);
    };
    // Initial measurement runs synchronously pre-paint (SSR-safe, corrected before first paint by ResizeObserver).
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(o);
    ro.observe(i);
    return () => ro.disconnect();
  }, [designWidth]);

  return (
    <div ref={outer} className={cn("w-full overflow-hidden", className)} style={{ height }}>
      <div ref={inner} style={{ width: designWidth, transform: `scale(${scale})`, transformOrigin: "top left" }}>
        {children}
      </div>
    </div>
  );
}

/* Minimal browser chrome: three quiet dots and the address pill — just
   enough to say "this is a page at your address" without the traffic-light
   cliché. The pill is what the claim bar mirrors into. */
export function BrowserFrame({ url, children }: { url: string; children: React.ReactNode }) {
  return (
    <div className="bg-card ring-border overflow-hidden rounded-t-2xl text-left shadow-[0_24px_64px_-24px_rgb(26_34_56/0.35)] ring-1">
      <div className="bg-secondary/70 border-border grid grid-cols-[1fr_auto_1fr] items-center border-b px-5 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="bg-border size-2.5 rounded-full" />
          <span className="bg-border size-2.5 rounded-full" />
          <span className="bg-border size-2.5 rounded-full" />
        </div>
        <div className="bg-card ring-border text-muted-foreground flex items-center gap-1.5 rounded-full px-4 py-1 font-mono text-[11px] ring-1">
          <Lock className="size-3" aria-hidden="true" />
          <span>{url}</span>
        </div>
      </div>
      {children}
    </div>
  );
}
