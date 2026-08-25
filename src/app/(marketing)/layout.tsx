import type { Metadata } from "next";
import { Geist_Mono, Instrument_Sans } from "next/font/google";
import { SITE } from "@/features/marketing/site";

// Landing typography: Instrument Sans (a grotesk with a little more character
// than Inter — the single-storey "a", the narrow round letters) for headings
// and body, Geist Mono for the small uppercase labels and the claim bar's
// URL. Both are variable Google fonts, self-hosted by next/font. They
// re-declare the root layout's --font-sans / --font-mono variables on the
// marketing wrapper, so only the landing changes — the app keeps Inter +
// JetBrains Mono. The wordmark uses the same sans.
const instrumentSans = Instrument_Sans({ variable: "--font-sans", subsets: ["latin"], display: "swap" });
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
  // landing's own palette — warm paper ground, ink-navy text, one cobalt
  // accent — independent of the app's `.dark` tokens on <html>. Landing
  // components use tokens only and never `dark:` utilities (see spec: Theme
  // scoping).
  return (
    // `font-sans` re-resolves the variable here (font-family is inherited from
    // <html> as a computed value, so redefining the variable alone would not
    // switch the face).
    <div
      className={`${instrumentSans.variable} ${geistMono.variable} marketing bg-background text-foreground flex min-h-full flex-1 flex-col font-sans antialiased`}
    >
      {children}
    </div>
  );
}
