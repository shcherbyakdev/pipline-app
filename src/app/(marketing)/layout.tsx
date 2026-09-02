import type { Metadata } from "next";
import { Geist_Mono, Inter, Outfit } from "next/font/google";
import { SITE } from "@/features/marketing/site";
import { CookieNotice } from "@/features/marketing/components/cookie-notice";

// Landing typography: Inter for everything that is read (headlines at
// weight 500, body at 400, controls at 500), Outfit Semibold for the one
// word that is a logo, Geist Mono only where a value is a value (the handle
// URL, tick labels). All variable Google fonts, self-hosted by next/font.
// They re-declare the root layout's --font-sans / --font-mono variables on
// the marketing wrapper and add --font-display (the wordmark face), so only
// the landing changes; the app keeps its own.
const inter = Inter({ variable: "--font-sans", subsets: ["latin", "cyrillic"], display: "swap" });
const outfit = Outfit({ variable: "--font-display", subsets: ["latin"], weight: ["600"], display: "swap" });
const geistMono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"], display: "swap" });

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
  // landing's own world: warm off-white ground, soft grey panels, near-black
  // type, colour only where it names a kind of booking. Independent of the
  // app's `.dark` tokens on <html>. Landing components use tokens only and
  // never `dark:` utilities.
  return (
    // `font-sans` re-resolves the variable here (font-family is inherited from
    // <html> as a computed value, so redefining the variable alone would not
    // switch the face).
    <div
      className={`${inter.variable} ${outfit.variable} ${geistMono.variable} marketing bg-background text-foreground flex min-h-full flex-1 flex-col font-sans antialiased`}
    >
      {/* Scroll-revealed blocks start at opacity 0 and rely on JS to show
          them; without JS they must simply be visible. */}
      <noscript>
        <style>{`.marketing .reveal{opacity:1;transform:none}`}</style>
      </noscript>
      {children}
      <CookieNotice />
    </div>
  );
}
