import type { Metadata } from "next";
import { DevBanner } from "@/features/billing/dev/components/dev-banner";

export const metadata: Metadata = { title: "Booklo dev billing" };

/* The provider's pages are not Booklo's pages: a hosted checkout looks like
   the payment processor, not like the app you left. So this is a plain light
   surface with no app chrome — no sidebar, no nav — which also makes it
   obvious at a glance that you have hopped somewhere else.

   `.light` (globals.css) opts the subtree out of the `dark:` variants the
   root <html class="dark"> would otherwise apply — the (marketing) layout
   precedent. */
export default function DevBillingLayout({ children }: LayoutProps<"/dev/billing">) {
  return (
    <div className="light bg-background text-foreground flex min-h-full flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-lg flex-col gap-6 p-6">
        <DevBanner />
        {children}
      </div>
    </div>
  );
}
