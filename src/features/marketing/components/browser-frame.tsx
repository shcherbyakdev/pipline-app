"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Copy, Lock, PanelLeft, Plus, RotateCw, Share } from "lucide-react";
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

/* Light browser chrome: traffic lights, nav icons, a URL pill, actions. */
export function BrowserFrame({ url, children }: { url: string; children: React.ReactNode }) {
  return (
    <div className="bg-card ring-border overflow-hidden rounded-t-2xl text-left shadow-[0_-20px_80px_rgb(0_0_0/0.12)] ring-1">
      <div className="bg-secondary border-border flex items-center gap-3 border-b px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
        </div>
        <div className="text-foreground/30 flex items-center gap-2">
          <PanelLeft className="size-3.5" aria-hidden="true" />
          <ChevronLeft className="size-3.5" aria-hidden="true" />
          <ChevronRight className="size-3.5 opacity-60" aria-hidden="true" />
        </div>
        <div className="bg-card text-foreground/60 mx-auto flex items-center gap-1.5 rounded-md px-6 py-1 font-mono text-[10px]">
          <Lock className="size-3" aria-hidden="true" />
          <span>{url}</span>
        </div>
        <div className="text-foreground/30 flex items-center gap-2">
          <RotateCw className="size-3.5" aria-hidden="true" />
          <Share className="size-3.5" aria-hidden="true" />
          <Plus className="size-3.5" aria-hidden="true" />
          <Copy className="size-3.5" aria-hidden="true" />
        </div>
      </div>
      {children}
    </div>
  );
}
