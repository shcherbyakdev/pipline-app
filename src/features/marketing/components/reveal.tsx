"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/* Fades a block up once it scrolls into view. Writes `data-in` straight to
   the DOM (no state, so nothing re-renders); the transition itself lives in
   globals.css (`.reveal`) and is off under reduced motion. JS-off is covered
   by the <noscript> in the (marketing) layout. `delay` staggers siblings. */
export function Reveal({
  as = "div",
  delay = 0,
  className,
  children,
}: {
  as?: "div" | "li";
  delay?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLElement>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!("IntersectionObserver" in window)) {
      el.setAttribute("data-in", "");
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          el.setAttribute("data-in", "");
          io.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -6% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return React.createElement(
    as,
    { ref, className: cn("reveal", className), style: { "--reveal-delay": `${delay}ms` } },
    children,
  );
}
