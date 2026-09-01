import Link from "next/link";
import type { Flags } from "@/lib/flags";
import { PLANS } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";
import type { PlanStatus } from "../queries";

/* The account tag in the top bar: Free or Premium, from the effective plan
   (comp, provider row or waitlist — the shell doesn't care which). It links
   to wherever the org can change it: /billing while billing sells plans,
   /waitlist while the waitlist is the way up; a plain chip otherwise.
   Presentational and hook-free, so the client TopBar can render it. */
export function PlanTag({ status, flags }: { status: PlanStatus; flags: Pick<Flags, "billing" | "premium_waitlist"> }) {
  const premium = status.plan !== "free";
  const label = premium ? "Premium" : "Free";
  const title = status.waitlisted
    ? "Premium via the waitlist, free while we build"
    : `${PLANS[status.plan].name} plan`;
  const href = flags.billing ? "/billing" : flags.premium_waitlist && !premium ? "/waitlist" : null;
  const className = cn(
    "inline-flex h-5 items-center rounded-full border px-2 text-[11px] font-medium leading-none tracking-[0.01em] transition-colors duration-150 ease-strong outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
    premium
      ? "border-transparent bg-brand/15 text-brand-text"
      : "border-border text-muted-foreground hover:text-foreground",
    href && "hover:bg-muted",
  );
  const body = (
    <>
      <span className="sr-only">Plan: </span>
      {label}
    </>
  );
  return href ? (
    <Link href={href} title={title} className={className}>
      {body}
    </Link>
  ) : (
    <span title={title} className={className}>
      {body}
    </span>
  );
}
