import type { Metadata } from "next";
import { SITE } from "@/features/marketing/site";

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
  // `marketing` pairs with the `.light.marketing` compound selector in
  // globals.css to re-point `--ring` at the teal `--primary` (see that file
  // for why it has to be a compound selector rather than a utility class).
  return (
    <div className="light marketing bg-background text-foreground flex min-h-full flex-1 flex-col">
      {children}
    </div>
  );
}
