import { listOfferings } from "@/features/rentals/queries";
import { OfferingsList } from "@/features/rentals/components/offerings-list";
import { OfferingDialog } from "@/features/rentals/components/offering-dialog";

export default async function RentalsPage() {
  const offerings = await listOfferings();
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Rentals</h1>
        <OfferingDialog />
      </div>
      {offerings.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No rentals yet — a rental is a unit type clients book by night or day (a flat, a car
          class, a room). Add one, then add its units.
        </p>
      ) : (
        <OfferingsList offerings={offerings} />
      )}
    </div>
  );
}
