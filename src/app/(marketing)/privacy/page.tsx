import type { Metadata } from "next";
import { MarketingNav } from "@/features/marketing/components/marketing-nav";
import { MarketingFooter } from "@/features/marketing/components/marketing-footer";
import { SITE } from "@/features/marketing/site";

export const metadata: Metadata = { title: "Privacy — Booklo" };

// Static legal page — always live, unlike /pricing. Not part of the
// site.test.ts forbidden-copy corpus: a privacy notice is a legal disclosure,
// not marketing copy, and it must name the real processor of card data.
export default function PrivacyPage() {
  return (
    <>
      <MarketingNav />
      <main className="flex-1">
        <article className="mx-auto w-full max-w-2xl px-6 py-20 md:py-28">
          <h1 className="text-3xl font-medium tracking-[-0.03em] md:text-4xl">Privacy Policy</h1>
          <p className="text-muted-foreground mt-2 text-sm">Last updated: August 18, 2026</p>

          <div className="mt-10 flex flex-col gap-8 [&_h2]:text-lg [&_h2]:font-medium [&_p]:text-foreground/80 [&_p]:mt-2 [&_p]:leading-relaxed [&_li]:text-foreground/80 [&_li]:leading-relaxed [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1">
            <section>
              <h2>What we store</h2>
              <p>
                {SITE.name} is a booking page and widget for solo providers and small teams. We
                store the minimum needed to run bookings and your account:
              </p>
              <ul>
                <li>Your account email, name and the org details you enter (business name, logo, brand colour, address if you add one).</li>
                <li>Your staff members&apos; names and booking links, if you use the team feature.</li>
                <li>
                  For each client booking: the client&apos;s name, email and an optional note they leave
                  when booking — nothing else. No client accounts, no documents, no client card numbers.
                </li>
                <li>
                  Your subscription status (plan, renewal date, whether billing is active) so the
                  product can enforce your plan&apos;s limits. We never see or store your card details —
                  card transactions are processed by Stripe, our merchant of record, and card data
                  never touches our servers.
                </li>
              </ul>
            </section>

            <section>
              <h2>How we use it</h2>
              <p>
                To run the booking flow (availability, confirmations, reminders, cancellations and
                reschedules), to render your hosted page and embed, and to operate your
                subscription. We do not sell personal data or share it with advertisers.
              </p>
            </section>

            <section>
              <h2>Retention</h2>
              <p>
                Client booking data is kept for as long as your account is active, plus a short
                window afterward for support and dispute handling, then deleted. You can request
                deletion of your account and its data at any time by contacting us.
              </p>
            </section>

            <section>
              <h2>Contact</h2>
              <p>
                Questions about this policy or a request to access or delete your data can be sent
                to the address on your account, or through the contact link in your dashboard.
              </p>
            </section>
          </div>
        </article>
      </main>
      <MarketingFooter />
    </>
  );
}
