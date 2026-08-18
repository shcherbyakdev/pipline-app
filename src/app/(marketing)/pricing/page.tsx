import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BILLING_ENABLED } from "@/lib/flags";
import { MarketingNav } from "@/features/marketing/components/marketing-nav";
import { MarketingFooter } from "@/features/marketing/components/marketing-footer";
import { PricingTable } from "@/features/marketing/components/pricing-table";

export const metadata: Metadata = { title: "Pricing — Booklo" };

// Dormant until the flag flips (lib/flags.ts): the route file exists so the
// page can be built and reviewed ahead of the flip, but nothing links here
// and it 404s until BILLING_ENABLED is true.
export default function PricingPage() {
  if (!BILLING_ENABLED) notFound();

  return (
    <>
      <MarketingNav />
      <main className="flex-1">
        <PricingTable />
      </main>
      <MarketingFooter />
    </>
  );
}
