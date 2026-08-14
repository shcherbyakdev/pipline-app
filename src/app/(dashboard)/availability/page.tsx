import { getAvailabilityAdmin } from "@/features/scheduling/queries";
import { AvailabilityEditor } from "@/features/scheduling/components/availability-editor";

export default async function AvailabilityPage() {
  const { rules, exceptions } = await getAvailabilityAdmin();
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <h1 className="text-lg font-semibold">Availability</h1>
      <AvailabilityEditor rules={rules} exceptions={exceptions} />
    </div>
  );
}
