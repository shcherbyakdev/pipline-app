import { PLANS } from "@/lib/billing/plans";
import { isOverrideActive } from "@/lib/billing/overrides";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { grantPlanOverride, revokePlanOverride } from "../actions";
import type { OrgAdminView } from "../queries";
import { todayUtc } from "../schema";

/* One org's billing state as the owner sees it: the provider row (read-only),
   the comp override, the effective plan, and the grant/revoke forms. */

// Fixed locale + UTC (current-plan.tsx idiom): hydration must not depend on
// the server's locale.
const formatInstant = (iso: string) =>
  `${new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC",
  }).format(new Date(iso))} UTC`;

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="font-mono text-sm">{value}</dd>
    </div>
  );
}

export function SubscriptionPanel({ view, now }: { view: OrgAdminView; now: Date }) {
  const { org, subscription: sub, override } = view;
  const active = isOverrideActive(override, now);
  // The one state the owner cannot see from either side alone: the comp wins
  // for entitlements while the provider keeps charging the card. Nothing in
  // the code prevents it (granting a comp to a paying org is legitimate — a
  // goodwill month, say), so it is surfaced rather than blocked.
  const doubleBilled = active && (sub?.status === "active" || sub?.status === "past_due");
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2 rounded-lg border p-4">
        <h2 className="font-medium">Effective plan</h2>
        <p className="text-lg font-semibold">
          {PLANS[view.effectivePlan].name}
          {active ? <span className="text-muted-foreground ml-2 text-sm font-normal">(complimentary)</span> : null}
        </p>
        {doubleBilled ? (
          <p className="text-sm text-amber-600 dark:text-amber-500">
            This org has an active comp AND a live provider subscription — the comp wins for entitlements
            while the card is still billed. Revoke the comp or cancel the subscription in the provider.
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-2 rounded-lg border p-4">
        <h2 className="font-medium">Provider subscription</h2>
        {sub ? (
          <dl className="flex flex-col gap-1">
            <Row label="Plan" value={`${sub.plan} · ${sub.interval}`} />
            <Row label="Status" value={sub.status} />
            <Row label="Seats" value={String(sub.seats)} />
            <Row label="Period end" value={sub.currentPeriodEnd ? formatInstant(sub.currentPeriodEnd) : "—"} />
            <Row label="Cancel at period end" value={sub.cancelAtPeriodEnd ? "yes" : "no"} />
            <Row label="Customer id" value={sub.providerCustomerId} />
            <Row label="Subscription id" value={sub.providerSubscriptionId} />
          </dl>
        ) : (
          <p className="text-muted-foreground text-sm">No provider row — {org.name} has never checked out.</p>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-lg border p-4">
        <h2 className="font-medium">Complimentary plan</h2>
        {override ? (
          <dl className="flex flex-col gap-1">
            <Row label="Plan" value={override.plan} />
            <Row label="Expires" value={override.expiresAt ? formatInstant(override.expiresAt) : "never"} />
            <Row label="State" value={active ? "in effect" : "expired"} />
            <Row label="Note" value={override.note ?? "—"} />
            <Row label="Granted by" value={`${override.grantedBy} · ${formatInstant(override.grantedAt)}`} />
          </dl>
        ) : (
          <p className="text-muted-foreground text-sm">None.</p>
        )}

        <form action={grantPlanOverride} className="flex flex-col gap-3 border-t pt-3">
          <input type="hidden" name="org" value={org.id} />
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="plan">Plan</Label>
              <select
                id="plan"
                name="plan"
                defaultValue={override?.plan ?? "pro"}
                className="border-input bg-background h-9 rounded-md border px-3 text-sm"
              >
                <option value="pro">Pro</option>
                <option value="team">Team</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="expires">Expires (UTC, optional)</Label>
              {/* `min` mirrors grantOverrideInput's refine so the browser's
                  picker greys out what the action would refuse anyway. */}
              <Input id="expires" name="expires" type="date" min={todayUtc(now)} defaultValue={override?.expiresAt?.slice(0, 10) ?? ""} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="note">Note</Label>
              <Input id="note" name="note" maxLength={200} defaultValue={override?.note ?? ""} placeholder="why this org" />
            </div>
          </div>
          <div>
            <Button type="submit">{override ? "Update comp" : "Grant comp"}</Button>
          </div>
        </form>

        {override ? (
          <form action={revokePlanOverride}>
            <input type="hidden" name="org" value={org.id} />
            <Button type="submit" variant="destructive">
              Revoke comp
            </Button>
          </form>
        ) : null}
      </section>
    </div>
  );
}
