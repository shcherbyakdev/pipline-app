import { MarketingNav } from "@/features/marketing/components/marketing-nav";
import { MarketingFooter } from "@/features/marketing/components/marketing-footer";
import { SITE } from "@/features/marketing/site";

export default function LandingPage() {
  return (
    <>
      <MarketingNav />
      <main className="flex-1">
        <section className="mx-auto w-full max-w-6xl px-6 py-24">
          <h1 className="text-5xl font-semibold tracking-tight">{SITE.headline}</h1>
        </section>
      </main>
      <MarketingFooter />
    </>
  );
}
