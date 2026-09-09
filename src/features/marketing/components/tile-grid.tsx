"use client";

import * as React from "react";
import { usePrefersReducedMotion } from "./reduced-motion";

/* The hero band's ground: a grid of periwinkle glass tiles that glow in a
   ring spreading out from wherever the pointer moves. Plain DOM and CSS
   (globals.css "Hero tiles"): every tile is a div with a glass gradient
   and bevel highlights; its highlight layer runs one keyframe pulse whose
   delay grows with the tile's distance from the pointer, so the glow
   travels outward at a speed set in CSS and dims with distance. This
   hook only measures: on a pointer move it writes each tile's distance
   (in tiles) as a custom property, the move's speed as the pulse's
   amplitude, and flips the keyframe name so the pulse restarts without a
   reflow. Idle for a few seconds (or a touch screen), it starts a ring
   from a random tile now and then; off screen it stays quiet; under
   reduced motion the tiles hold still. */

const COLS = 14;
const ROWS = 10;
const PULSE_EVERY_MS = 90;
const IDLE_MS = 3000;
const AUTO_EVERY_MS = 2600;

export function TileGrid({ className }: { className?: string }) {
  const host = React.useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();

  React.useEffect(() => {
    const el = host.current;
    if (!el || reduced) return;
    const tiles = Array.from(el.querySelectorAll<HTMLElement>("[data-tile]"));
    let centres: { x: number; y: number }[] = [];
    let size = 1;
    const measure = () => {
      const r = el.getBoundingClientRect();
      size = tiles[0]?.getBoundingClientRect().width || 1;
      centres = tiles.map((t) => {
        const b = t.getBoundingClientRect();
        return { x: b.left + b.width / 2 - r.left, y: b.top + b.height / 2 - r.top };
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);

    let flip = false;
    const pulse = (px: number, py: number, amp: number) => {
      for (let i = 0; i < tiles.length; i++) {
        tiles[i].style.setProperty("--d", (Math.hypot(centres[i].x - px, centres[i].y - py) / size).toFixed(2));
      }
      el.style.setProperty("--amp", amp.toFixed(2));
      flip = !flip;
      el.style.setProperty("--pulse", flip ? "tile-pulse-a" : "tile-pulse-b");
    };

    let last: { x: number; y: number; t: number } | null = null;
    let lastInput = 0;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const now = performance.now();
      lastInput = now;
      if (last && (now - last.t < PULSE_EVERY_MS || Math.hypot(x - last.x, y - last.y) < size * 0.6)) return;
      const speed = last ? Math.hypot(x - last.x, y - last.y) / Math.max(16, now - last.t) : 0.4; // px per ms
      pulse(x, y, Math.min(1, 0.35 + speed * 0.5));
      last = { x, y, t: now };
    };
    const onLeave = () => {
      last = null;
    };
    el.addEventListener("pointermove", onMove, { passive: true });
    el.addEventListener("pointerleave", onLeave);

    /* Idle rings from a random tile, only while the band is on screen. */
    let timer = 0;
    let visible = false;
    const tick = () => {
      if (visible && performance.now() - lastInput > IDLE_MS && centres.length) {
        const c = centres[Math.floor(Math.random() * centres.length)];
        pulse(c.x, c.y, 0.75);
      }
      timer = window.setTimeout(tick, AUTO_EVERY_MS + Math.random() * 1400);
    };
    timer = window.setTimeout(tick, IDLE_MS);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
    });
    io.observe(el);

    return () => {
      clearTimeout(timer);
      io.disconnect();
      ro.disconnect();
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, [reduced]);

  return (
    <div ref={host} aria-hidden="true" className={`tiles ${className ?? ""}`} style={{ "--cols": COLS } as React.CSSProperties}>
      {Array.from({ length: COLS * ROWS }, (_, i) => (
        <div key={i} data-tile className="tile" />
      ))}
    </div>
  );
}
