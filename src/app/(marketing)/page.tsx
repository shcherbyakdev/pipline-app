import { MarketingNav } from "@/features/marketing/components/marketing-nav";
import { MarketingFooter } from "@/features/marketing/components/marketing-footer";
import { Hero } from "@/features/marketing/components/hero";
import { HowItWorks } from "@/features/marketing/components/how-it-works";
import { FeatureGrid } from "@/features/marketing/components/feature-grid";
import { ProductShowcase } from "@/features/marketing/components/product-showcase";
import { EmbedShowcase } from "@/features/marketing/components/embed-showcase";
import { Faq } from "@/features/marketing/components/faq";
import { FinalCta } from "@/features/marketing/components/final-cta";

export default function LandingPage() {
  return (
    <>
      <MarketingNav />
      <main className="flex-1">
        <Hero />
        <HowItWorks />
        <FeatureGrid />
        <ProductShowcase />
        <EmbedShowcase />
        <Faq />
        <FinalCta />
      </main>
      <MarketingFooter />
    </>
  );
}
