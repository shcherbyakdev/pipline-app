import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { PortalPanel, portalDoneMessage } from "@/features/billing/dev/components/portal-panel";
import { requireDevBilling } from "@/features/billing/dev/guard";
import { readFakeRow } from "@/features/billing/dev/queries";
import { safeReturnUrl } from "@/features/billing/dev/return-url";

/* The fake provider's customer portal (plan §7.6). No `org` param, unlike
   checkout: the portal is always about the caller's own subscription, so the
   session decides which org it is and nothing in the URL can point it
   elsewhere. */

function one(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default async function DevPortalPage({ searchParams }: PageProps<"/dev/billing/portal">) {
  const sp = await searchParams;
  const { org } = await requireDevBilling();
  // Vetted once, here: it becomes the "Back to Booklo" href on BOTH
  // branches below (this page's and the panel's), and an href is exactly
  // where an unvetted `return` would be an open redirect.
  const returnTo = safeReturnUrl(one(sp.return));
  const row = await readFakeRow(createAdminClient(), org.id);

  if (!row) {
    // "Reset to Free" lands here — carry its confirmation across rather than
    // let the redirect swallow it.
    const doneMessage = portalDoneMessage(one(sp.done));
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold">No subscription</h1>
        {doneMessage ? (
          <p role="status" className="text-sm text-emerald-600">
            {doneMessage}
          </p>
        ) : null}
        <p className="text-muted-foreground text-sm">
          {org.name} is on Free — there is nothing to manage here yet. Pick a plan in Booklo and come
          back through checkout.
        </p>
        <div className="flex items-center gap-3">
          <Link href="/billing" className="text-sm underline underline-offset-4">
            Go to Billing
          </Link>
          <a href={returnTo} className="text-muted-foreground text-sm underline underline-offset-4">
            Back to Booklo
          </a>
        </div>
      </div>
    );
  }

  return (
    <PortalPanel
      row={row}
      returnTo={returnTo}
      done={one(sp.done) ?? undefined}
      error={one(sp.error) ?? undefined}
    />
  );
}
