"use client";

import * as React from "react";
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

