import { env } from "@/env";
import { hostLabel } from "@/lib/booking/url";
import { MarketingNav } from "@/features/marketing/components/marketing-nav";
import { MarketingFooter } from "@/features/marketing/components/marketing-footer";
import { Hero } from "@/features/marketing/components/hero";
import { Audience } from "@/features/marketing/components/audience";
import { HowItWorks } from "@/features/marketing/components/how-it-works";
import { Features } from "@/features/marketing/components/features";
import { Faq } from "@/features/marketing/components/faq";
import { FinalCta } from "@/features/marketing/components/final-cta";

export default function LandingPage() {
  const host = hostLabel(env.NEXT_PUBLIC_APP_URL);
  return (
    <>
      <MarketingNav />
      <main className="flex-1">
        <Hero host={host} />
        <HowItWorks />
        <Features />
        <Audience />
        <Faq />
        <FinalCta host={host} />
      </main>
      <MarketingFooter />
    </>
  );
}
