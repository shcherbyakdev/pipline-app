import Link from "next/link";
import { Fragment } from "react";
import { env } from "@/env";
import { requireOrg } from "@/lib/auth/session";
import { requireInternal } from "@/features/utils/guard";
import { getDashboardFlags } from "@/lib/flags/resolve";
import { FLAG_DEFAULTS, FLAG_KEYS, FLAG_META } from "@/lib/flags";

/* The hub (spec §3.2): where the utilities live, and an Environment card so
   the owner sees at a glance what this deployment is configured as. */
const TOOLS = [
  { href: "/utils/subscriptions", title: "Subscriptions", blurb: "Grant or revoke a complimentary Pro/Team plan on any org." },
  { href: "/utils/flags", title: "Feature flags", blurb: "Turn dormant features on or off for one org." },
  { href: "/utils/import", title: "Import bookings", blurb: "Load a migrating studio's future bookings from a CSV (S8 migration kit)." },
] as const;

export default async function UtilsHubPage() {
  await requireInternal();
  // The hub is already behind requireInternal, so this is not a second gate:
  // it is how the page learns WHICH org is the owner's, which is the org the
  // dev portal link would open. The owner always has one.
  const { org } = await requireOrg();
  const ownerFlags = await getDashboardFlags(org.id);
  // requireDevBilling (features/billing/dev/guard.ts) 404s unless all three
  // hold, the org's own `billing` flag included — so the link has to check the
  // same three or it would advertise a dead end. APP_ENV, not NODE_ENV, for
  // the same reason the guard uses it.
  const fakeProviderAlive = env.APP_ENV !== "production" && env.BILLING_PROVIDER === "fake";
  const devBillingAlive = fakeProviderAlive && ownerFlags.billing;
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">Utilities</h1>
      <ul className="grid gap-3 sm:grid-cols-2">
        {TOOLS.map((tool) => (
          <li key={tool.href}>
            <Link href={tool.href} className="hover:bg-muted flex h-full flex-col gap-1 rounded-lg border p-4">
              <span className="font-medium">{tool.title}</span>
              <span className="text-muted-foreground text-sm">{tool.blurb}</span>
            </Link>
          </li>
        ))}
      </ul>
      <section className="flex flex-col gap-2 rounded-lg border p-4">
        <h2 className="font-medium">Environment</h2>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          {/* APP_ENV is the production marker every prod-only gate reads
              (env-schema.ts); NODE_ENV is only how Next was started. Both
              shown, because "development" next to "production" is exactly
              the mix-up worth seeing at a glance. */}
          <dt className="text-muted-foreground">APP_ENV</dt>
          <dd className="font-mono">{env.APP_ENV ?? "unset"}</dd>
          <dt className="text-muted-foreground">NODE_ENV</dt>
          <dd className="font-mono">{process.env.NODE_ENV}</dd>
          <dt className="text-muted-foreground">App URL</dt>
          <dd className="font-mono">{env.NEXT_PUBLIC_APP_URL}</dd>
          <dt className="text-muted-foreground">Billing provider</dt>
          <dd className="font-mono">{env.BILLING_PROVIDER}</dd>
          {FLAG_KEYS.map((key) => (
            <Fragment key={key}>
              <dt className="text-muted-foreground">Flag default · {FLAG_META[key].label}</dt>
              <dd className="font-mono">{FLAG_DEFAULTS[key] ? "on" : "off"}</dd>
            </Fragment>
          ))}
        </dl>
        {devBillingAlive ? (
          <Link href="/dev/billing/portal" className="text-sm underline underline-offset-4">
            Open the fake billing portal for your own org →
          </Link>
        ) : fakeProviderAlive ? (
          <p className="text-muted-foreground text-sm">
            Turn <code className="font-mono">billing</code> on for your own org in Feature flags to use the
            fake billing portal.
          </p>
        ) : null}
      </section>
    </div>
  );
}
