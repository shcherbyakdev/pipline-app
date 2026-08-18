import type { Metadata } from "next";
import { InternalBanner } from "@/features/utils/components/internal-banner";
import { requireInternal } from "@/features/utils/guard";

export const metadata: Metadata = { title: "Booklo internal tools", robots: { index: false, follow: false } };

/* Standalone: no dashboard chrome, no nav link anywhere — the owner reaches
   this by URL (spec §3.2). `.light` opts out of the root's dark variants, the
   /dev/billing precedent. The guard runs here AND in every page/action: the
   layout does not protect a route segment on its own (Next renders pages
   independently of layouts on client navigation), it just fails fast. */
export default async function UtilsLayout({ children }: LayoutProps<"/utils">) {
  await requireInternal();
  return (
    <div className="light bg-background text-foreground flex min-h-full flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
        <InternalBanner />
        {children}
      </div>
    </div>
  );
}
