import { listOfferings, getOrgCurrency } from "@/features/rentals/queries";
import { OfferingsList } from "@/features/rentals/components/offerings-list";
import { OfferingDialog } from "@/features/rentals/components/offering-dialog";
import { SPACES } from "@/features/orgs/vocab";
import { getSchedulingSettings } from "@/features/orgs/queries";
import { EmptyState } from "@/components/shared/empty-state";
import { PageIntro } from "@/components/shell/page-header";
import { env } from "@/env";

export default async function RentalsPage() {
  const [offerings, currency, settings] = await Promise.all([
    listOfferings(),
    getOrgCurrency(),
    getSchedulingSettings(),
  ]);
  // Copy-link buttons need the public address; before the org picks a handle
  // there is nothing to copy (spec §5: hidden when there is no handle).
  const linkBase = settings?.handle ? { appUrl: env.NEXT_PUBLIC_APP_URL, handle: settings.handle } : null;
  // Empty: one composed panel that says what a space is and carries the
  // create action, so the page has exactly one CTA either way.
  if (offerings.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
        <EmptyState title="Add your first space" action={<OfferingDialog currency={currency} />}>
          {SPACES.empty}
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between gap-3">
        <PageIntro>{SPACES.intro}</PageIntro>
        <OfferingDialog currency={currency} />
      </div>
      <OfferingsList offerings={offerings} currency={currency} linkBase={linkBase} />
    </div>
  );
}
