import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { bookingPath } from "@/lib/booking/url";
import { searchOrgs } from "../queries";

// Fixed locale + UTC (current-plan.tsx idiom): hydration must not depend on
// the server's locale.
const formatDate = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(iso));

/* Shared by /utils/subscriptions and /utils/flags: a GET form (so the search
   is a URL you can reload) and the matches, each linking to `?org=<id>` on
   the page that rendered the picker. Each row shows name · slug · handle ·
   signup date — the created date is what tells two similarly named orgs
   apart, and it is already in the one query the picker makes. */
export async function OrgPicker({ basePath, q }: { basePath: string; q: string }) {
  const orgs = await searchOrgs(q);
  return (
    <div className="flex flex-col gap-4">
      <form action={basePath} method="get" className="flex items-center gap-2">
        <Input name="q" defaultValue={q} placeholder="Search by name, slug or handle" aria-label="Search orgs" />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      {orgs.length === 0 ? (
        <p className="text-muted-foreground text-sm">No orgs match.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {orgs.map((org) => (
            <li key={org.id}>
              <Link
                href={`${basePath}?org=${org.id}`}
                className="hover:bg-muted flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-sm"
              >
                <span className="font-medium">{org.name}</span>
                <span className="text-muted-foreground font-mono text-xs">
                  {org.slug}
                  {org.handle ? ` · ${bookingPath(org.handle)}` : ""}
                  {` · ${formatDate(org.createdAt)}`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** First value of a search param — entries may be arrays when a key repeats
    (the /dev/billing `one()` idiom, exported for the /utils pages). */
export function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}
