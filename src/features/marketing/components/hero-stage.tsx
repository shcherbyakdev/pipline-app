"use client";

import * as React from "react";

/* The stage under the hero's product: the screenshot, the phone and the
   story. The story (hero-story.tsx) only plays while the stage is in view
   (globals.css: its players hold at their first frame without `data-play`),
   and each arrival restarts it from the top, so a visitor never meets it
   mid-sentence; leaving the viewport stops the loop, so nothing runs
   off-screen. It starts once the phone's chip is in view (85% of the
   stage, on a 900px screen a short scroll) and stops only when most of
   the stage has gone (under 25%), so reading just below it does not cut
   the loop. */
const START = 0.85;
const STOP = 0.25;

export function HeroStage({ children }: { children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        const playing = el.hasAttribute("data-play");
        if (e.intersectionRatio >= START && !playing) {
          el.setAttribute("data-play", "");
        } else if (e.intersectionRatio < STOP && playing) {
          el.removeAttribute("data-play"); // the players lose their animation, so the next start is from the top
        }
      },
      { threshold: [STOP, START] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className="hero-stage relative">
      {children}
    </div>
  );
}
