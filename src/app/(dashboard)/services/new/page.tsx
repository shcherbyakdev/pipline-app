import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { listStaff } from "@/features/scheduling/staff-queries";
import { ServiceForm } from "@/features/scheduling/components/service-form";
import { requireOrg } from "@/lib/auth/session";
import { gateHref } from "@/lib/billing/gate-href";
import { evaluateServiceGate } from "@/lib/billing/gates";

/* A new service, on a page of its own (no dialog on the list). `?staff=<id>`
   is a member's page asking for a service that person alone offers. */
export default async function NewServicePage({ searchParams }: PageProps<"/services/new">) {
  const { org } = await requireOrg();
  const [staff, doorHref, params, t] = await Promise.all([
    listStaff(),
    gateHref(org.id, evaluateServiceGate),
    searchParams,
    getTranslations("services"),
  ]);
  // Same gate as the list's button: a capped org never sees a form the
  // action would only refuse.
  if (doorHref) redirect(doorHref);
  // Only a real active member narrows the service; a stale or foreign id
  // would otherwise create one nobody offers.
  const forMember = staff.find((s) => s.active && s.id === params.staff) ?? null;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        {/* Back to wherever the ask came from: the list, or the person the
            service is being made for. */}
        <Link
          href={forMember ? `/team/${forMember.id}` : "/services"}
          className="text-muted-foreground w-fit text-xs hover:underline"
        >
          {forMember ? `← ${forMember.name}` : t("back")}
        </Link>
        <h1 className="text-lg font-semibold">{t("newButton")}</h1>
      </div>
      <ServiceForm staff={staff} forStaffId={forMember?.id} />
    </div>
  );
}
