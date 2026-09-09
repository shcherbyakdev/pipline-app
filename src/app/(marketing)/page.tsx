import { env } from "@/env";
import { hostLabel } from "@/lib/booking/url";
import { MarketingNav } from "@/features/marketing/components/marketing-nav";
import { MarketingFooter } from "@/features/marketing/components/marketing-footer";
import { Hero } from "@/features/marketing/components/hero";
import { HowItWorks } from "@/features/marketing/components/how-it-works";
import { Money } from "@/features/marketing/components/money";
import { Compound } from "@/features/marketing/components/compound";
import { Morning } from "@/features/marketing/components/morning";
import { Features } from "@/features/marketing/components/features";
import { Premium } from "@/features/marketing/components/premium";
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
        <Money />
        <Compound />
        <Morning />
        <Features host={host} />
        <Premium />
        <Faq />
        <FinalCta host={host} />
      </main>
      <MarketingFooter />
    </>
  );
}
