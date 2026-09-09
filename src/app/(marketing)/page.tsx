import { env } from "@/env";
import { hostLabel } from "@/lib/booking/url";
import { MarketingNav } from "@/features/marketing/components/marketing-nav";
import { MarketingFooter } from "@/features/marketing/components/marketing-footer";
import { Hero } from "@/features/marketing/components/landing-hero";
import { Features } from "@/features/marketing/components/features";

/* One hero (interfacecraft.dev-referenced): nav, title, sub, the claim
   bar, the product in its glass band; under it what it does, in one
   narrow column; footer. */
export default function LandingPage() {
  const host = hostLabel(env.NEXT_PUBLIC_APP_URL);
  return (
    <>
      <MarketingNav />
      <main className="flex-1">
        <Hero host={host} />
        <Features />
      </main>
      <MarketingFooter />
    </>
  );
}
