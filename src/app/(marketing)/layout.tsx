import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { SITE } from "@/features/marketing/site";

// Inline so it wins over the unlayered `.light` declaration on the same element.
const LANDING_TOKENS = { "--ring": "var(--primary)" } as CSSProperties;

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
  // `.light` re-declares the design tokens so the landing renders light
  // beneath the app's dark <html>. Landing components use tokens only and
  // never `dark:` utilities (see spec: Theme scoping).
  // `--ring` is re-pointed at the teal `--primary` here (and only here) so
  // keyboard focus is clearly visible on white; the shared `.light` block keeps
  // its neutral ring for the app's own light theme.
  return (
    <div style={LANDING_TOKENS} className="light bg-background text-foreground flex min-h-full flex-1 flex-col">
      {children}
    </div>
  );
}
