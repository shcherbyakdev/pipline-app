"use client";

import * as React from "react";

/* Holds its children's entrance until the section scrolls into view: the
   `.animate-fade-up` inside are paused at their first frame while
   `data-reveal` is on (globals.css "Features reveal"), and run once
   `data-in` lands. The attribute is server-rendered so the hold is there
   from first paint; the <noscript> lets JS-off readers see the content. */
export function RevealSection(props: React.ComponentProps<"section">) {
  const ref = React.useRef<HTMLElement>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        el.setAttribute("data-in", "");
        io.disconnect();
      },
      { threshold: 0.1 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <>
      <noscript>
        <style>{`[data-reveal] .animate-fade-up{animation-play-state:running}`}</style>
      </noscript>
      <section ref={ref} data-reveal="" {...props} />
    </>
  );
}
