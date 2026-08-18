import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FLAG_DEFAULTS } from "@/lib/flags";
import { MarketingNav } from "@/features/marketing/components/marketing-nav";
import { MarketingFooter } from "@/features/marketing/components/marketing-footer";
import { PricingTable } from "@/features/marketing/components/pricing-table";

export const metadata: Metadata = { title: "Pricing — Booklo" };

// No org here — the marketing site shows pricing only once billing is on for
// everyone (the environment default), never per org.
export default function PricingPage() {
  if (!FLAG_DEFAULTS.billing) notFound();

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
