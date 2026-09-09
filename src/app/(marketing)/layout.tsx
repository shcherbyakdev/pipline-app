import type { Metadata } from "next";
import { Newsreader, Outfit } from "next/font/google";
import { SITE } from "@/features/marketing/site";
import { CookieNotice } from "@/features/marketing/components/cookie-notice";

// Landing typography (interfacecraft.dev-referenced, 2026-09-09): the
// visitor's own system face for everything that is read (the `.marketing`
// block in globals.css sets --font-sans to the system stack), Newsreader,
// a transitional serif with optical sizes, for the one title, and Outfit
// Semibold for the wordmark. Both Google faces self-hosted by next/font.
const newsreader = Newsreader({ variable: "--font-newsreader", subsets: ["latin"], weight: ["400"], display: "swap" });
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
  // landing's own world: white ground, near-black type, the system font.
  // Landing components use tokens only and never `dark:` utilities.
  return (
    <div className={`${newsreader.variable} ${outfit.variable} marketing bg-background text-foreground flex min-h-full flex-1 flex-col font-sans antialiased`}>
      {children}
      <CookieNotice />
    </div>
  );
}
