import type { Metadata } from "next";
import { Fragment_Mono } from "next/font/google";
import localFont from "next/font/local";
import { SITE } from "@/features/marketing/site";

// Landing typography (throxy.com reference: PP Neue Montreal + Fragment Mono).
// PP Neue Montreal is commercial, so the sans is Switzer — a near twin, free
// via Fontshare, self-hosted (see features/marketing/fonts/README.md). Fragment
// Mono is the reference's own label face and is on Google Fonts. Both
// re-declare the root layout's --font-sans / --font-mono variables on the
// marketing wrapper, so only the landing changes — the app keeps Inter +
// JetBrains Mono. The wordmark uses the same sans.
const switzer = localFont({
  src: [
    { path: "../../features/marketing/fonts/Switzer-Variable.woff2", weight: "100 900", style: "normal" },
    { path: "../../features/marketing/fonts/Switzer-VariableItalic.woff2", weight: "100 900", style: "italic" },
  ],
  variable: "--font-sans",
  display: "swap",
});
const fragmentMono = Fragment_Mono({ variable: "--font-mono", subsets: ["latin"], weight: "400" });

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
  // landing's own palette — near-black forest ground, pale-yellow accent —
  // independent of the app's `.dark` tokens on <html>. Landing components use
  // tokens only and never `dark:` utilities (see spec: Theme scoping).
  return (
    // `font-sans` re-resolves the variable here (font-family is inherited from
    // <html> as a computed value, so redefining the variable alone would not
    // switch the face).
    <div className={`${switzer.variable} ${fragmentMono.variable} marketing bg-background text-foreground font-sans flex min-h-full flex-1 flex-col`}>
      {children}
    </div>
  );
}
