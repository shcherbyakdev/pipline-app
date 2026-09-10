import type { Metadata } from "next";
import { MarketingNav } from "@/features/marketing/components/marketing-nav";
import { MarketingFooter } from "@/features/marketing/components/marketing-footer";
import { PricingTable } from "@/features/marketing/components/pricing-table";

export const metadata: Metadata = { title: "Pricing — Booklo" };

// Always public, billing flag or not (2026-09-10): what a plan costs is what
// someone deciding to sign up asks first, and the page is also what a payment
// provider's review reads to see what we sell. While billing is off the copy
// says so (PRICING.note in features/marketing/site.ts) and every card sends
// people to /signup, so nothing here promises a checkout that is not there.
export default function PricingPage() {
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
