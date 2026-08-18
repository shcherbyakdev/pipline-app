import type { Metadata } from "next";
import { MarketingNav } from "@/features/marketing/components/marketing-nav";
import { MarketingFooter } from "@/features/marketing/components/marketing-footer";
import { SITE } from "@/features/marketing/site";

export const metadata: Metadata = { title: "Terms of Service — Booklo" };

// Static legal page — always live, unlike /pricing. Not part of the
// site.test.ts forbidden-copy corpus: terms of service are a legal
// disclosure, not marketing copy, and must describe billing truthfully.
export default function TermsPage() {
  return (
    <>
      <MarketingNav />
      <main className="flex-1">
        <article className="mx-auto w-full max-w-2xl px-6 py-20 md:py-28">
          <h1 className="text-3xl font-medium tracking-[-0.03em] md:text-4xl">Terms of Service</h1>
          <p className="text-muted-foreground mt-2 text-sm">Last updated: August 18, 2026</p>

          <div className="mt-10 flex flex-col gap-8 [&_h2]:text-lg [&_h2]:font-medium [&_p]:text-foreground/80 [&_p]:mt-2 [&_p]:leading-relaxed [&_li]:text-foreground/80 [&_li]:leading-relaxed [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1">
            <section>
              <h2>The service</h2>
              <p>
                {SITE.name} provides a hosted booking page and an embeddable widget that let your
                clients book appointments with you without creating an account. These terms govern
                your use of the service.
              </p>
            </section>

            <section>
              <h2>Plans and billing</h2>
              <p>
                Paid plans are subscriptions billed monthly or yearly. You can cancel at any time
                from Billing in your dashboard; your plan stays active until the end of the period
                you already paid for, and you are not billed again after that. Card transactions are
                handled by Stripe, our merchant of record; refunds are governed by Stripe&apos;s
                Managed Payments consumer terms, which apply to any payment made through the
                service.
              </p>
            </section>

            <section>
              <h2>Acceptable use</h2>
              <p>
                You are responsible for the accuracy of the booking page you publish and for the
                conduct of any staff member you add. Do not use the service to collect data you are
                not entitled to collect, to impersonate another business, or to send booking
                confirmations or reminders for anything other than genuine appointments.
              </p>
            </section>

            <section>
              <h2>Liability</h2>
              <p>
                The service is provided as-is. To the extent permitted by law, we are not liable for
                indirect or consequential loss arising from missed, double-booked or cancelled
                appointments, or from downtime of the hosted page or widget.
              </p>
            </section>

            <section>
              <h2>Governing law</h2>
              <p>Governing law: Poland.</p>
            </section>
          </div>
        </article>
      </main>
      <MarketingFooter />
    </>
  );
}
