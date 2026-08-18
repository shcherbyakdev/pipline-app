import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  formatUsd,
  PAID_PLANS,
  PLANS,
  pricePerMonth,
  type PaidPlanId,
  type PlanId,
} from "@/lib/billing/plans";
import { CTA, PRICING } from "@/features/marketing/site";
import { marketingButton } from "./marketing-button";

// Every column is PLANS + PRICING — no price or limit is typed a second time
// here, so a number changed in lib/billing/plans.ts changes this page too.
const COLUMNS: PlanId[] = ["free", ...PAID_PLANS];

export function PricingTable() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-20 md:py-28">
      <h1 className="text-3xl font-medium tracking-[-0.03em] md:text-4xl">{PRICING.heading}</h1>
      <p className="text-muted-foreground mt-3 max-w-xl">{PRICING.sub}</p>

      <div className="mt-12 grid gap-4 sm:grid-cols-3">
        {COLUMNS.map((id) => (
          <PlanCard key={id} id={id} />
        ))}
      </div>

      <div className="mt-16 overflow-x-auto">
        <table className="w-full min-w-[36rem] border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th scope="col" className="py-3 pr-4 font-normal">
                <span className="sr-only">Feature</span>
              </th>
              {COLUMNS.map((id) => (
                <th key={id} scope="col" className="px-4 py-3 font-medium">
                  {PLANS[id].name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {PRICING.rows.map((row) => (
              <tr key={row.label}>
                <th scope="row" className="text-muted-foreground py-3 pr-4 text-left font-normal">
                  {row.label}
                </th>
                {COLUMNS.map((id) => (
                  <td key={id} className="px-4 py-3">
                    {row[id]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-muted-foreground mt-4 text-sm">{PRICING.moreComing}</p>

      <div className="mt-10 max-w-xl space-y-2">
        <p className="text-foreground/80 text-sm">{PRICING.founder}</p>
        <p className="text-muted-foreground text-xs">{PRICING.note}</p>
      </div>
    </section>
  );
}

function PlanCard({ id }: { id: PlanId }) {
  const plan = PLANS[id];
  const paid = id !== "free" ? (id as PaidPlanId) : null;

  return (
    <div className={cn("bg-card flex flex-col gap-4 rounded-xl border p-6", id === "pro" && "border-primary/50")}>
      <div className="flex flex-col gap-1">
        <span className="font-medium">{plan.name}</span>
        <p className="text-muted-foreground text-sm">{plan.blurb}</p>
      </div>

      <div className="flex flex-col gap-1">
        {paid ? (
          <>
            <span className="text-3xl font-medium tracking-[-0.02em]">
              {formatUsd(pricePerMonth(paid, "year"))}
              <span className="text-muted-foreground text-base font-normal"> /mo</span>
            </span>
            <span className="text-muted-foreground text-xs">
              billed yearly, or {formatUsd(PLANS[id].monthly)} monthly
            </span>
          </>
        ) : (
          <span className="text-3xl font-medium tracking-[-0.02em]">Free</span>
        )}
      </div>

      <Link href="/signup" className={marketingButton(id === "pro" ? "primary" : "neutral", "md")}>
        {CTA.getStarted}
      </Link>
    </div>
  );
}
