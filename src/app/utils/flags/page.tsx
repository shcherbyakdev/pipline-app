import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInternal } from "@/features/utils/guard";
import { readOrgAdminView } from "@/features/utils/queries";
import { orgIdInput, orgSearchInput, utilsDoneMessage, utilsErrorMessage } from "@/features/utils/schema";
import { OrgPicker, firstParam } from "@/features/utils/components/org-picker";
import { FlagsTable } from "@/features/utils/components/flags-table";

/* Per-org feature toggles (spec §3.5). `?org=` picks the org; without it, the picker. */
export default async function UtilsFlagsPage({ searchParams }: PageProps<"/utils/flags">) {
  await requireInternal();
  const sp = await searchParams;
  const orgId = firstParam(sp.org);
  const q = orgSearchInput.parse({ q: firstParam(sp.q) }).q;
  // A malformed id (not a UUID) is treated the same as an unknown org: it
  // must never reach readOrgAdminView's `.eq("id", …)`, which Postgres
  // rejects outright ("invalid input syntax for type uuid") and 500s.
  if (orgId && !orgIdInput.safeParse({ org: orgId }).success) notFound();

  if (!orgId) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold">Feature flags</h1>
        <OrgPicker basePath="/utils/flags" q={q} />
      </div>
    );
  }

  const view = await readOrgAdminView(orgId);
  if (!view) notFound();
  const done = utilsDoneMessage(firstParam(sp.done));
  const error = utilsErrorMessage(firstParam(sp.error));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold">
          {view.org.name} <span className="text-muted-foreground font-mono text-sm font-normal">{view.org.slug}</span>
        </h1>
        <div className="flex gap-3 text-sm">
          <Link href={`/utils/subscriptions?org=${view.org.id}`} className="underline underline-offset-4">
            Subscription
          </Link>
          <Link href="/utils/flags" className="underline underline-offset-4">
            Change org
          </Link>
        </div>
      </div>
      {done ? (
        <p role="status" className="text-sm text-emerald-600">
          {done}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <FlagsTable view={view} />
    </div>
  );
}
