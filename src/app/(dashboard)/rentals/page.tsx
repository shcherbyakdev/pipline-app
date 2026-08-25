import { listOfferings, getOrgCurrency } from "@/features/rentals/queries";
import { OfferingsList } from "@/features/rentals/components/offerings-list";
import { OfferingDialog } from "@/features/rentals/components/offering-dialog";
import { SPACES } from "@/features/orgs/vocab";
import { getSchedulingSettings } from "@/features/orgs/queries";
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
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <div className="flex items-center justify-end">
        <OfferingDialog currency={currency} />
      </div>
      {offerings.length === 0 ? (
        <p className="text-muted-foreground text-sm">{SPACES.empty}</p>
      ) : (
        <OfferingsList offerings={offerings} currency={currency} linkBase={linkBase} />
      )}
    </div>
  );
}
