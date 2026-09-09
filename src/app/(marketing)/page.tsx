import { env } from "@/env";
import { hostLabel } from "@/lib/booking/url";
import { MarketingNav } from "@/features/marketing/components/marketing-nav";
import { MarketingFooter } from "@/features/marketing/components/marketing-footer";
import { Hero } from "@/features/marketing/components/landing-hero";
import { HowItWorks } from "@/features/marketing/components/how-it-works";
import { Features } from "@/features/marketing/components/features";

/* Nav, the hero (title, sub, the claim bar, the product with its story),
   how it works on a pinned ink panel that advances with the scroll, what
   it does in one narrow column with the action, footer. */
export default function LandingPage() {
  const host = hostLabel(env.NEXT_PUBLIC_APP_URL);
  return (
    <>
      <MarketingNav />
      <main className="flex-1">
        <Hero host={host} />
        <HowItWorks />
        <Features />
      </main>
      <MarketingFooter />
    </>
  );
}
