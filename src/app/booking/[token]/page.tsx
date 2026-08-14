import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { clientKeyFrom } from "@/lib/tokens";
import { resolveBookingToken } from "@/lib/tokens/booking";
import { formatWhenLine } from "@/features/scheduling/templates";

const STATUS_LINE: Record<string, string> = {
  confirmed: "Confirmed",
  cancelled_by_client: "Cancelled",
  cancelled_by_provider: "Cancelled by the provider",
  rescheduled: "Rescheduled",
};

export default async function BookingManagePage({ params }: PageProps<"/booking/[token]">) {
  const { token } = await params;
  const result = await resolveBookingToken(token, clientKeyFrom(await headers()));
  if (result.status === "rate_limited") {
    return (
      <main className="mx-auto w-full max-w-md p-6">
        <p className="text-muted-foreground text-sm">Too many requests — try again shortly.</p>
      </main>
    );
  }
  if (result.status !== "ok") notFound();
  const b = result.booking;
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 p-6">
      <h1 className="text-lg font-semibold">{b.orgName}</h1>
      <div className="flex flex-col gap-1 rounded-md border p-4 text-sm">
        <p className="font-medium">{b.serviceName}</p>
        <p>{formatWhenLine(b.startsAt, b.orgTimezone)}</p>
        <p className="text-muted-foreground">{STATUS_LINE[b.status] ?? b.status}</p>
      </div>
      {b.status === "confirmed" ? (
        <>
          <a className="text-sm underline" href={`/booking/${token}/calendar.ics`}>
            Add to calendar (.ics)
          </a>
          <p className="text-muted-foreground text-xs">
            Need to change or cancel? Reply to your confirmation email — online changes are coming
            soon.
          </p>
        </>
      ) : null}
    </main>
  );
}
