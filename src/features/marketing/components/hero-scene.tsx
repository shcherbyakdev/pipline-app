"use client";

import dynamic from "next/dynamic";

/* The cube grid pulls in three.js, so it loads on the client only and
   after the page has painted; until then the band is its dark ground. */
const CubeGrid = dynamic(() => import("./cube-grid").then((m) => m.CubeGrid), { ssr: false });

export function HeroScene({ className }: { className?: string }) {
  return <CubeGrid className={className} />;
}
