import { MarketingNav } from "@/features/marketing/components/marketing-nav";
import { MarketingFooter } from "@/features/marketing/components/marketing-footer";
import { Hero } from "@/features/marketing/components/hero";

export default function LandingPage() {
  return (
    <>
      <MarketingNav />
      <main className="flex-1">
        <Hero />
      </main>
      <MarketingFooter />
    </>
  );
}
