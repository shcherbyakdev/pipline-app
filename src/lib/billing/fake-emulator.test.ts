// Pure emulator core — no env, no I/O. See task-1-brief.md for the exact
// interfaces/semantics this file locks down.
import { describe, it, expect } from "vitest";
import { TEAM_INCLUDED_SEATS } from "./plans";
import {
  classifyTestCard,
  addInterval,
  fakeIds,
  checkoutEvents,
  actionEvents,
  FAKE_ACTIONS,
  type FakeRow,
} from "./fake-emulator";

const NOW = new Date("2026-08-18T12:00:00.000Z");

describe("classifyTestCard", () => {
  const card = (number: string, exp = "12/30", cvc = "123") => ({ number, exp, cvc });

  it("4242424242424242 → ok", () => {
    expect(classifyTestCard(card("4242424242424242"), NOW)).toBe("ok");
  });
  it("4000000000000002 → declined", () => {
    expect(classifyTestCard(card("4000000000000002"), NOW)).toBe("declined");
  });
  it("4000000000009995 → insufficient_funds", () => {
    expect(classifyTestCard(card("4000000000009995"), NOW)).toBe("insufficient_funds");
  });
  it("4000000000000341 → past_due_first_charge", () => {
    expect(classifyTestCard(card("4000000000000341"), NOW)).toBe("past_due_first_charge");
  });
  it("an unlisted but Luhn-valid 16-digit number → ok", () => {
    // 4111111111111111 is a well-known Luhn-valid test PAN not in our table.
    expect(classifyTestCard(card("4111111111111111"), NOW)).toBe("ok");
  });
  it("accepts spaces in the number", () => {
    expect(classifyTestCard(card("4242 4242 4242 4242"), NOW)).toBe("ok");
  });
  it("a Luhn-invalid 16-digit number → invalid", () => {
    expect(classifyTestCard(card("4111111111111112"), NOW)).toBe("invalid");
  });
  it("wrong digit count → invalid", () => {
    expect(classifyTestCard(card("424242424242"), NOW)).toBe("invalid");
  });
  it("an expired card → invalid even for the success PAN", () => {
    expect(classifyTestCard(card("4242424242424242", "07/26"), NOW)).toBe("invalid");
  });
  it("the exact expiry month is still valid (end of month counts)", () => {
    // NOW is 2026-08-18; 08/26 has not yet ended.
    expect(classifyTestCard(card("4242424242424242", "08/26"), NOW)).toBe("ok");
  });
  it("accepts MM/YYYY as well as MM/YY", () => {
    expect(classifyTestCard(card("4242424242424242", "08/2026"), NOW)).toBe("ok");
  });
  it("a bad cvc (too short) → invalid", () => {
    expect(classifyTestCard(card("4242424242424242", "12/30", "12"), NOW)).toBe("invalid");
  });
  it("a bad cvc (too long) → invalid", () => {
    expect(classifyTestCard(card("4242424242424242", "12/30", "12345"), NOW)).toBe("invalid");
  });
  it("accepts a 4-digit cvc", () => {
    expect(classifyTestCard(card("4242424242424242", "12/30", "1234"), NOW)).toBe("ok");
  });
});

describe("addInterval", () => {
  it("clamps Jan 31 + 1 month to Feb 28 in a non-leap year", () => {
    const d = addInterval(new Date("2026-01-31T10:00:00.000Z"), "month");
    expect(d.toISOString()).toBe("2026-02-28T10:00:00.000Z");
  });
  it("clamps Jan 31 + 1 month to Feb 29 in a leap year", () => {
    const d = addInterval(new Date("2024-01-31T10:00:00.000Z"), "month");
    expect(d.toISOString()).toBe("2024-02-29T10:00:00.000Z");
  });
  it("adds a plain month with no clamp needed", () => {
    const d = addInterval(new Date("2026-03-15T09:30:00.000Z"), "month");
    expect(d.toISOString()).toBe("2026-04-15T09:30:00.000Z");
  });
  it("rolls over into the next year", () => {
    const d = addInterval(new Date("2026-12-15T00:00:00.000Z"), "month");
    expect(d.toISOString()).toBe("2027-01-15T00:00:00.000Z");
  });
  it("adds a plain year with no clamp needed", () => {
    const d = addInterval(new Date("2026-08-18T12:00:00.000Z"), "year");
    expect(d.toISOString()).toBe("2027-08-18T12:00:00.000Z");
  });
  it("clamps Feb 29 + 1 year to Feb 28", () => {
    const d = addInterval(new Date("2024-02-29T00:00:00.000Z"), "year");
    expect(d.toISOString()).toBe("2025-02-28T00:00:00.000Z");
  });
});

describe("fakeIds", () => {
  it("builds deterministic customer/subscription ids from the org id", () => {
    expect(fakeIds("org-1")).toEqual({ customer: "cus_fake_org-1", subscription: "sub_fake_org-1" });
  });
});

describe("checkoutEvents", () => {
  it("creates an active subscription on a good charge", () => {
    const events = checkoutEvents({ orgId: "org-1", plan: "pro", interval: "month", now: NOW });
    expect(events).toHaveLength(1);
    const [ev] = events;
    expect(ev.provider).toBe("fake");
    expect(ev.type).toBe("subscription_created");
    expect(ev.orgId).toBe("org-1");
    expect(ev.occurredAt).toBe(NOW.toISOString());
    expect(ev.providerEventId).toBe(`fake-checkout-org-1-${NOW.getTime()}`);
    expect(ev.subscription).toEqual({
      providerCustomerId: "cus_fake_org-1",
      providerSubscriptionId: "sub_fake_org-1",
      plan: "pro",
      interval: "month",
      seats: 1,
      status: "active",
      currentPeriodEnd: addInterval(NOW, "month").toISOString(),
      cancelAtPeriodEnd: false,
    });
  });

  it("gives Team the included seat count", () => {
    const [ev] = checkoutEvents({ orgId: "org-1", plan: "team", interval: "year", now: NOW });
    expect(ev.subscription?.seats).toBe(TEAM_INCLUDED_SEATS);
    expect(ev.subscription?.currentPeriodEnd).toBe(addInterval(NOW, "year").toISOString());
  });

  it("lands as past_due when the first charge fails", () => {
    const [ev] = checkoutEvents({ orgId: "org-1", plan: "pro", interval: "month", now: NOW, firstChargeFails: true });
    expect(ev.subscription?.status).toBe("past_due");
  });

  it("reuses an existing customer id for a resubscribe", () => {
    const [ev] = checkoutEvents({ orgId: "org-1", plan: "pro", interval: "month", now: NOW, existingCustomerId: "cus_fake_old" });
    expect(ev.subscription?.providerCustomerId).toBe("cus_fake_old");
    // Subscription id is always freshly minted, independent of the customer.
    expect(ev.subscription?.providerSubscriptionId).toBe("sub_fake_org-1");
  });
});

const ORG_ID = "org-1";

function row(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    providerCustomerId: "cus_fake_org-1",
    providerSubscriptionId: "sub_fake_org-1",
    plan: "pro",
    status: "active",
    interval: "month",
    seats: 1,
    currentPeriodEnd: "2026-09-18T12:00:00.000Z",
    cancelAtPeriodEnd: false,
    ...overrides,
  };
}

describe("actionEvents", () => {
  it("cancel_at_period_end flags the row without changing status", () => {
    const [ev] = actionEvents("cancel_at_period_end", row({ status: "past_due" }), ORG_ID, NOW);
    expect(ev.type).toBe("subscription_updated");
    expect(ev.subscription?.cancelAtPeriodEnd).toBe(true);
    expect(ev.subscription?.status).toBe("past_due");
    expect(ev.raw).toEqual({ emulator: "cancel_at_period_end" });
  });

  it("resume clears the flag", () => {
    const [ev] = actionEvents("resume", row({ cancelAtPeriodEnd: true }), ORG_ID, NOW);
    expect(ev.type).toBe("subscription_updated");
    expect(ev.subscription?.cancelAtPeriodEnd).toBe(false);
  });

  it("cancel_now expires immediately", () => {
    const [ev] = actionEvents("cancel_now", row(), ORG_ID, NOW);
    expect(ev.type).toBe("subscription_expired");
    expect(ev.subscription?.status).toBe("expired");
  });

  it("switch_pro switches plan and seats down to 1", () => {
    const [ev] = actionEvents("switch_pro", row({ plan: "team", seats: TEAM_INCLUDED_SEATS }), ORG_ID, NOW);
    expect(ev.type).toBe("subscription_updated");
    expect(ev.subscription?.plan).toBe("pro");
    expect(ev.subscription?.seats).toBe(1);
    // interval/period untouched
    expect(ev.subscription?.interval).toBe("month");
    expect(ev.subscription?.currentPeriodEnd).toBe("2026-09-18T12:00:00.000Z");
  });

  it("switch_team switches plan and seats up to the included count", () => {
    const [ev] = actionEvents("switch_team", row({ plan: "pro", seats: 1 }), ORG_ID, NOW);
    expect(ev.subscription?.plan).toBe("team");
    expect(ev.subscription?.seats).toBe(TEAM_INCLUDED_SEATS);
  });

  it("switch_month resets the period from now", () => {
    const [ev] = actionEvents("switch_month", row({ interval: "year" }), ORG_ID, NOW);
    expect(ev.subscription?.interval).toBe("month");
    expect(ev.subscription?.currentPeriodEnd).toBe(addInterval(NOW, "month").toISOString());
  });

  it("switch_year resets the period from now", () => {
    const [ev] = actionEvents("switch_year", row({ interval: "month" }), ORG_ID, NOW);
    expect(ev.subscription?.interval).toBe("year");
    expect(ev.subscription?.currentPeriodEnd).toBe(addInterval(NOW, "year").toISOString());
  });

  it("fail_renewal marks past_due", () => {
    const [ev] = actionEvents("fail_renewal", row({ status: "active" }), ORG_ID, NOW);
    expect(ev.type).toBe("payment_failed");
    expect(ev.subscription?.status).toBe("past_due");
  });

  it("recover marks active and rolls the period from now", () => {
    const [ev] = actionEvents("recover", row({ status: "past_due", interval: "year" }), ORG_ID, NOW);
    expect(ev.type).toBe("payment_recovered");
    expect(ev.subscription?.status).toBe("active");
    expect(ev.subscription?.currentPeriodEnd).toBe(addInterval(NOW, "year").toISOString());
  });

  describe("advance_period", () => {
    // The realistic case: the dev clicks "advance" right after checkout, well
    // before the real clock reaches the (month/year-out) period end — so the
    // anchor is in the FUTURE relative to `now`. The PERIOD moves to the
    // anchor; the EVENT still happens now (see the occurredAt test below).
    it("expires a subscription flagged to cancel at period end", () => {
      const periodEnd = new Date(NOW.getTime() + 1000 * 60 * 60); // ahead of now
      const [ev] = actionEvents(
        "advance_period",
        row({ cancelAtPeriodEnd: true, currentPeriodEnd: periodEnd.toISOString() }),
        ORG_ID,
        NOW,
      );
      expect(ev.type).toBe("subscription_expired");
      expect(ev.subscription?.status).toBe("expired");
    });

    it("expires a past_due subscription (dunning exhausted)", () => {
      const periodEnd = new Date(NOW.getTime() + 1000 * 60 * 60);
      const [ev] = actionEvents(
        "advance_period",
        row({ status: "past_due", currentPeriodEnd: periodEnd.toISOString() }),
        ORG_ID,
        NOW,
      );
      expect(ev.type).toBe("subscription_expired");
      expect(ev.subscription?.status).toBe("expired");
    });

    it("renews an active subscription, rolling the period forward from the old end", () => {
      const periodEnd = new Date(NOW.getTime() + 1000 * 60 * 60);
      const [ev] = actionEvents(
        "advance_period",
        row({ status: "active", interval: "month", currentPeriodEnd: periodEnd.toISOString() }),
        ORG_ID,
        NOW,
      );
      expect(ev.type).toBe("subscription_updated");
      expect(ev.subscription?.status).toBe("active");
      expect(ev.subscription?.currentPeriodEnd).toBe(addInterval(periodEnd, "month").toISOString());
    });

    // The guard that makes the portal usable: `occurredAt` becomes
    // provider_updated_at, and apply_billing_event (0043) drops any later
    // event stamped before it. A period end is normally MONTHS out, so
    // stamping the jump's destination would freeze the row until the wall
    // clock caught up — every subsequent cancel/switch/fail silently stale.
    it("stamps occurredAt with `now`, never the period end it jumps to", () => {
      const future = new Date(NOW.getTime() + 1000 * 60 * 60 * 24 * 30);
      const past = new Date(NOW.getTime() - 1000 * 60 * 60 * 24 * 40);
      for (const periodEnd of [future, past]) {
        const [ev] = actionEvents(
          "advance_period",
          row({ status: "active", currentPeriodEnd: periodEnd.toISOString() }),
          ORG_ID,
          NOW,
        );
        expect(ev.occurredAt).toBe(NOW.toISOString());
      }
    });
  });

  // Same rule for every other action: one clock, the real one.
  it("stamps every action's occurredAt with `now`", () => {
    for (const entry of FAKE_ACTIONS) {
      const [ev] = actionEvents(entry.id, row({ status: "past_due", cancelAtPeriodEnd: true }), ORG_ID, NOW);
      expect(ev.occurredAt, entry.id).toBe(NOW.toISOString());
    }
  });
});

describe("FAKE_ACTIONS", () => {
  const byId = (id: string) => FAKE_ACTIONS.find((a) => a.id === id)!;

  it("cancel_at_period_end is only enabled when active/past_due and not already flagged", () => {
    expect(byId("cancel_at_period_end").enabledWhen(row({ status: "active", cancelAtPeriodEnd: false }))).toBe(true);
    expect(byId("cancel_at_period_end").enabledWhen(row({ status: "past_due", cancelAtPeriodEnd: false }))).toBe(true);
    expect(byId("cancel_at_period_end").enabledWhen(row({ status: "active", cancelAtPeriodEnd: true }))).toBe(false);
    expect(byId("cancel_at_period_end").enabledWhen(row({ status: "expired" }))).toBe(false);
  });

  it("resume is only enabled when flagged", () => {
    expect(byId("resume").enabledWhen(row({ cancelAtPeriodEnd: true }))).toBe(true);
    expect(byId("resume").enabledWhen(row({ cancelAtPeriodEnd: false }))).toBe(false);
  });

  it("cancel_now is enabled unless already expired", () => {
    expect(byId("cancel_now").enabledWhen(row({ status: "active" }))).toBe(true);
    expect(byId("cancel_now").enabledWhen(row({ status: "expired" }))).toBe(false);
  });

  it("switch_pro/switch_team are enabled when the other plan is current", () => {
    expect(byId("switch_pro").enabledWhen(row({ plan: "team" }))).toBe(true);
    expect(byId("switch_pro").enabledWhen(row({ plan: "pro" }))).toBe(false);
    expect(byId("switch_team").enabledWhen(row({ plan: "pro" }))).toBe(true);
    expect(byId("switch_team").enabledWhen(row({ plan: "team" }))).toBe(false);
  });

  it("switch_month/switch_year are enabled when the other interval is current", () => {
    expect(byId("switch_month").enabledWhen(row({ interval: "year" }))).toBe(true);
    expect(byId("switch_month").enabledWhen(row({ interval: "month" }))).toBe(false);
    expect(byId("switch_year").enabledWhen(row({ interval: "month" }))).toBe(true);
    expect(byId("switch_year").enabledWhen(row({ interval: "year" }))).toBe(false);
  });

  it("fail_renewal is enabled only when active", () => {
    expect(byId("fail_renewal").enabledWhen(row({ status: "active" }))).toBe(true);
    expect(byId("fail_renewal").enabledWhen(row({ status: "past_due" }))).toBe(false);
  });

  it("recover is enabled only when past_due", () => {
    expect(byId("recover").enabledWhen(row({ status: "past_due" }))).toBe(true);
    expect(byId("recover").enabledWhen(row({ status: "active" }))).toBe(false);
  });

  it("advance_period is enabled unless expired", () => {
    expect(byId("advance_period").enabledWhen(row({ status: "active" }))).toBe(true);
    expect(byId("advance_period").enabledWhen(row({ status: "past_due" }))).toBe(true);
    expect(byId("advance_period").enabledWhen(row({ status: "expired" }))).toBe(false);
  });
});
