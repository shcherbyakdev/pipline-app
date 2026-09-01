# Premium waitlist — Design

**Date:** 2026-09-01
**Status:** Built with the spec (autonomous session); rulings open for Andrii's review
**Precedent:** billing slice (spec 2026-08-18-pricing-and-billing-design.md), internal utils (comp overrides, flags)

## 1. Goal

Billing exists but is not ready to sell. Until it is, the upgrade path is a
**Premium waitlist**: plan limits apply to every org (Free caps), and joining
the waitlist unlocks Pro's entitlements immediately, exactly as a purchase
would. Surfaces: a sidebar card, an account tag in the top bar, a `/waitlist`
page, a Premium section on the landing.

## 2. Decisions

1. **A second flag, not the billing flag.** `premium_waitlist` (default ON)
   sits beside `billing` (still OFF). `plansEnforced(flags) = billing ||
   premium_waitlist` is the ONLY question the enforcement readers ask
   (gates, public offering, badge, email badge, reminder quota, page
   sections, plan banner). `billing` keeps owning /billing, checkout, the
   portal and the marketing pricing copy.
2. **Waitlist = a third entitlement source, not a comp.** Its own table
   (`premium_waitlist`: org_id PK, joined_by email, joined_at) so the owner
   can list who joined and the perk can be withdrawn in one place. The seam
   (`getOrgSubscription`) ranks **comp override > live provider row >
   waitlist** via `pickSubscription`: first row that entitles wins, so a
   real Team never reads as Pro and the waitlist outlives a lapsed
   subscription. The seam is flag-agnostic: when billing launches, keep
   honouring early joiners or drop one read.
3. **Joining grants Pro, not Team.** Team's extra is roster size; the
   waitlist is a thank-you.
4. **Members write their own row through RLS.** INSERT policy pins
   `org_id ∈ user_orgs()` and `joined_by = auth.jwt()->>'email'`; no
   UPDATE/DELETE for members (leaving is an owner action in /utils via
   service_role). Explicit grants (0066), CHECK on `org_feature_flags.flag`
   widened.
5. **Refusal copy names the real door.** Gate messages take an
   `UpgradeHint`: `billing` ("Upgrade in Billing"), `waitlist` ("Join the
   Premium waitlist"), `none` ("Higher limits come with paid plans") for a
   waitlisted org already at Pro's cap. The plan banner's CTA follows the
   same rule and drops its link when there is no door.
6. **Shell data.** The layout reads `getPlanStatus()` (three seam rows, no
   counts, degrades to Free) only while `plansEnforced`; it feeds the
   top-bar `PlanTag` (Free / Premium, links to /waitlist or /billing) and the
   sidebar `WaitlistCard` (Free + not joined + flag on). Both are dumb.
7. **Landing.** A `Premium` section between Audience and FAQ while billing
   is off (`PREMIUM.shown = !BILLING_ON`), CTA → `/waitlist` (a signed-out
   visitor goes through login and back). The cost FAQ mentions the waitlist.
   No em-dashes, no forbidden words (site.test guards it).
8. **Existing orgs are capped at once.** With the flag default ON, every org
   not on the waitlist is Free: 1 bookable resource, 3 public services, 30
   reminder bookings/month, badge forced. That is the point; the sidebar
   card and the banner say how to lift it.

## 3. Deferred (deliberately)

- Owner-facing waitlist listing (/utils shows it per org only).
- Email on join / before pricing changes (no transport wired for it).
- Leaving the waitlist from the dashboard.
