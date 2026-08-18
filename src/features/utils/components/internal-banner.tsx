import Link from "next/link";
import { env } from "@/env";
import { envLabel } from "../env-label";

/* Masthead of every /utils page: says loudly that this is the owner's back
   office and WHICH environment it is pointed at (spec §3.2). */
export function InternalBanner() {
  const label = envLabel(process.env.NODE_ENV, env.NEXT_PUBLIC_APP_URL);
  const production = process.env.NODE_ENV === "production";
  return (
    <div
      className={
        production
          ? "flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3"
          : "flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3"
      }
    >
      <Link href="/utils" className="text-sm font-semibold underline-offset-4 hover:underline">
        Booklo internal tools
      </Link>
      <span className="font-mono text-xs">{label}</span>
    </div>
  );
}
