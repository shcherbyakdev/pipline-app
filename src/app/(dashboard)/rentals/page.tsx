import { listOfferings, getOrgCurrency } from "@/features/rentals/queries";
import { OfferingsList } from "@/features/rentals/components/offerings-list";
import { OfferingDialog } from "@/features/rentals/components/offering-dialog";
import { SPACES } from "@/features/orgs/vocab";

export default async function RentalsPage() {
  const offerings = await listOfferings();
  const currency = await getOrgCurrency();
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <div className="flex items-center justify-end">
        <OfferingDialog currency={currency} />
      </div>
      {offerings.length === 0 ? (
        <p className="text-muted-foreground text-sm">{SPACES.empty}</p>
      ) : (
        <OfferingsList offerings={offerings} currency={currency} />
      )}
    </div>
  );
}
