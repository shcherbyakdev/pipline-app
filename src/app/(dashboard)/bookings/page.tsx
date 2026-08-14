import { listBookings } from "@/features/scheduling/queries";
import { getSchedulingSettings } from "@/features/orgs/queries";
import { BookingsList } from "@/features/scheduling/components/bookings-list";

export default async function BookingsPage() {
  const [{ upcoming, past }, settings] = await Promise.all([
    listBookings(),
    getSchedulingSettings(),
  ]);
  const timeZone = settings?.timezone ?? "UTC";
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <h1 className="text-lg font-semibold">Bookings</h1>
      <BookingsList upcoming={upcoming} past={past} timeZone={timeZone} />
    </div>
  );
}
