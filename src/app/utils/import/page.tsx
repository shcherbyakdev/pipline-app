import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInternal } from "@/features/utils/guard";
import { getOrgSummary } from "@/features/utils/queries";
import { orgIdInput, orgSearchInput } from "@/features/utils/schema";
import { OrgPicker, firstParam } from "@/features/utils/components/org-picker";
import { ImportPanel } from "@/features/utils/components/import-panel";

/* S8 migration kit: import a pilot studio's future hourly bookings from a
   CSV (docs/migration/). `?org=` picks the org; without it, the picker. */
export default async function UtilsImportPage({ searchParams }: PageProps<"/utils/import">) {
  await requireInternal();
  const sp = await searchParams;
  const orgId = firstParam(sp.org);
  const q = orgSearchInput.parse({ q: firstParam(sp.q) }).q;
  // flags/page.tsx idiom: a malformed id must never reach a `.eq("id", …)`.
  if (orgId && !orgIdInput.safeParse({ org: orgId }).success) notFound();

  if (!orgId) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold">Import bookings</h1>
        <OrgPicker basePath="/utils/import" q={q} />
      </div>
    );
  }

  const org = await getOrgSummary(orgId);
  if (!org) notFound();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold">
          {org.name} <span className="text-muted-foreground font-mono text-sm font-normal">{org.slug}</span>
        </h1>
        <div className="flex gap-3 text-sm">
          <Link href={`/utils/flags?org=${org.id}`} className="underline underline-offset-4">
            Flags
          </Link>
          <Link href="/utils/import" className="underline underline-offset-4">
            Change org
          </Link>
        </div>
      </div>
      <ImportPanel orgId={org.id} />
    </div>
  );
}
