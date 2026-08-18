import Link from "next/link";
import { Fragment } from "react";
import { env } from "@/env";
import { requireInternal } from "@/features/utils/guard";
import { FLAG_DEFAULTS, FLAG_KEYS, FLAG_META } from "@/lib/flags";

/* The hub (spec §3.2): where the utilities live, and an Environment card so
   the owner sees at a glance what this deployment is configured as. */
const TOOLS = [
  { href: "/utils/subscriptions", title: "Subscriptions", blurb: "Grant or revoke a complimentary Pro/Team plan on any org." },
  { href: "/utils/flags", title: "Feature flags", blurb: "Turn dormant features on or off for one org." },
] as const;

export default async function UtilsHubPage() {
  await requireInternal();
  const devBillingAlive = process.env.NODE_ENV !== "production" && env.BILLING_PROVIDER === "fake";
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
        ) : null}
      </section>
    </div>
  );
}
