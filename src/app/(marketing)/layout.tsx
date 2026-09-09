import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import { SITE } from "@/features/marketing/site";
import { CookieNotice } from "@/features/marketing/components/cookie-notice";

// Landing typography (2026-09-09): the product's own face. Inter for
// everything read, inherited from the root layout, whose optical-size
// axis gives the headline the display cut (Linear's move); Outfit
// Semibold for the wordmark, self-hosted by next/font.
const outfit = Outfit({ variable: "--font-display", subsets: ["latin"], weight: ["600"], display: "swap" });

export const metadata: Metadata = {
  title: `${SITE.name} — ${SITE.tagline}`,
  description: SITE.description,
  openGraph: {
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
    type: "website",
  },
};

export default function MarketingLayout({ children }: LayoutProps<"/">) {
  // `.marketing` (globals.css) re-declares the design tokens with the
  // landing's own world: white ground, near-black type. Landing components
  // use tokens only and never `dark:` utilities.
  return (
    <div className={`${outfit.variable} marketing bg-background text-foreground flex min-h-full flex-1 flex-col font-sans antialiased`}>
      {children}
      <CookieNotice />
    </div>
  );
}
