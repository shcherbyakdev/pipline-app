# Admin IA — U4: Links & embeds — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every bookable thing gets its own link and its own embed: `?space=<id>` joins `?service=` on the hosted page and the embed (the embed also learns `?service=`), `?channel=services|spaces` restricts the widget to one channel on both, a pure `bookingLink` / `embedSnippet` pair builds every URL and snippet, the Website embed page gains a **Links & embeds** table (whole page · Appointments only / Spaces only · each team member · each service · each space, copy link + copy embed per row), and the Services and Spaces list rows get a **Copy link** button.

**Architecture:** Pure seams carry the logic and the tests — `lib/booking/channel.ts` (`resolveChannelParam`, `applyChannel`), `lib/booking/url.ts` (`LinkTarget`, `targetQuery`, `bookingLink`, `embedSrc`), `orgs/components/widget-embed-snippet.ts` (`embedSnippet`, target-aware title), `booking-page/initial-service.ts` (`resolveInitialOffering`), `booking-page/render/page-request.ts` (`initialRequest(serviceId, offeringId)`), `orgs/link-rows.ts` (`linkRows`). The two public routes parse the new params, filter the gated catalogue by channel **before** anything else uses it (so the widget, its group headings, and the builder's Services/Spaces/Staff sections all agree), and hand the deep-linked thing to the widget through the existing once-per-key request contract. Admin UI is two small client components (`LinksTable`, `CopyLinkButton`) over those seams. No data model, RPC or migration changes.

**Tech Stack:** Next.js 15 App Router (read `node_modules/next/dist/docs/` before touching routes), React 19, Supabase JS, Hugeicons free set (`Link01Icon`), Vitest 4 in a Node environment (`*.test.ts` only — no DOM tests in this repo), ESLint + `tsc --noEmit`.

**Spec:** `docs/superpowers/specs/2026-08-25-admin-ia-mode-separation-design.md` §5 (Links & embeds) and ruling 7. Read it first.

## Global Constraints

- **Base branch:** `feat/ia-u3` (PR #63) until it merges into `main`, then `main`. Work on `feat/ia-u4` in worktree `.claude/worktrees/ia-u4`. `next dev` inside a nested worktree needs `--webpack`; a fresh worktree has no `.env.local` (copy it from `.claude/worktrees/ia-u3`); drive the browser at **`http://localhost:3001`**, never `127.0.0.1` (that origin never hydrates).
- **Query params are exactly** `service` (uuid), `space` (uuid), `staff` (slug — embed only; the hosted page uses the `/<handle>/<slug>` path), `channel` (`services` | `spaces`). A malformed, unknown or unlisted value **degrades to the org flow — never a 404, never an empty widget**. `?service=` / `?space=` must name an item in the gated (and channel-filtered) catalogue, else `null`.
- **Composition on the embed:** channel is applied to the org catalogue first, then the `?staff=` pin on what remains; a pinned person with no bookable services drops the lock (existing rule). `?service=` resolves against the pinned services when a lock holds.
- **The hosted staff sub-page `/[handle]/[staffSlug]` is unchanged** (it never lists spaces).
- **Snippet format is unchanged** apart from the `src` query and the title: `<iframe data-rollout-embed src="…" style="width:100%;border:0" title="…"></iframe>\n<script src="<appUrl>/embed.js" async></script>`. Title: `Book a space` for a space/`channel=spaces` target, `Book an appointment` for a service/staff/`channel=services` target, else `embedTitle(mode)` (existing rule).
- **Code identifiers do not change:** `rental_*`, `rentalOfferingId`, `OfferingRow`, `PublicOffering`, `listOfferings`, `/rentals`, `data-rollout-embed` — copy only.
- **Forbidden words in provider-facing admin copy:** `rental`, `rentals`, `offering`, `offerings` (any case). Channel words come from `src/features/orgs/vocab.ts` (`SPACES.nav`, `SPACES.badge`, new `SPACES.only` / `APPOINTMENTS.only`); neutral words ("Whole booking page", "Copy link", "Copy embed", "Links & embeds", "Team", "Service") stay inline. `admin-copy.test.ts` guards the SOURCE of every `SURFACES` file (JSX text, labelled props, and `>…<` spans in comments) — `links-table.tsx` and `copy-link-button.tsx` join the list; keep those words out of their comments.
- **Clipboard writes are awaited** and a refusal shows the existing toast ("Couldn't copy — select the link text and copy manually."); success toasts "Copied" (the Team page idiom, `staff-list.tsx`).
- **Plan deviations from the spec, decided up front (rule on them, do not re-litigate):** (1) `embedSnippet` lives in `widget-embed-snippet.ts` (it needs `OrgMode` for the default title), `url.ts` gets the env/mode-free `bookingLink` + `embedSrc`; (2) `resolveChannelParam(param)` only parses — `applyChannel(catalog, channel)` degrades by what the gated catalogue actually contains (an org that sells a channel but has nothing active in it also degrades, which is the spec's "never an empty widget"); (3) `?channel=` filters the hosted page's `RenderContext`, so the builder's Services / Spaces / Staff sections of the other channel disappear as well (`publicSections` drops empty sections) — a card whose click reaches a widget that no longer lists it would be worse than the spec's "sections unaffected"; (4) copy-link controls are the Team page's ghost `Copy link` button (icon + text) rather than icon-only + tooltip — no Tooltip usage exists in the app; (5) "each bookable service" on the admin side means active AND linked to at least one active person (bookableAdminServices); plan caps are not applied — a capped service's link degrades to the org flow; the button is hidden on other rows. (6) copy toasts read "Link copied" / "Embed copied" (the row button too), not "Copied".
- **Tests:** Vitest Node env, `src/**/*.test.ts` only. No migrations. Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. After each task: `npx vitest run <touched dirs>` + `npm run typecheck` + `npx eslint <changed files>` green before committing; `npm run verify` once in Task 4; `graphify update .` at the end.

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/booking/channel.ts` (create) + `.test.ts` | `Channel`, `resolveChannelParam()`, `applyChannel()` — pure |
| `src/lib/booking/url.ts` (modify) + `url.test.ts` | `LinkTarget`, `targetQuery()`, `bookingLink()`, `embedSrc()` |
| `src/features/orgs/components/widget-embed-snippet.ts` (modify) + `.test.ts` | `embedSnippet(appUrl, handle, target?, mode?)` replaces `snippetFor` |
| `src/features/orgs/components/widget-appearance.tsx` (modify, one line) | calls `embedSnippet` |
| `src/features/booking-page/initial-service.ts` (modify) + `.test.ts` | `resolveInitialOffering()` beside `resolveInitialService()` |
| `src/features/booking-page/render/page-request.ts` (modify) + `.test.ts` | `initialRequest(serviceId, offeringId)` |
| `src/features/booking-page/render/page-state.tsx`, `page-renderer.tsx` (modify) | `initialOfferingId` next to `initialServiceId` |
| `src/app/[handle]/page.tsx` (modify) | `?space=`, `?channel=` |
| `src/app/embed/[handle]/page.tsx` (modify) | `?service=`, `?space=`, `?channel=` |
| `src/features/orgs/vocab.ts` (modify) + `vocab.test.ts` | `SPACES.only`, `APPOINTMENTS.only` |
| `src/features/orgs/link-rows.ts` (create) + `.test.ts` | `linkRows()` — the table's rows as data |
| `src/lib/clipboard.ts` (create) | `copyText()` — the awaited clipboard write, shared by the two new components |
| `src/components/copy-link-button.tsx` (create) | ghost "Copy link" button |
| `src/features/orgs/components/links-table.tsx` (create) | the Links & embeds table |
| `src/features/scheduling/components/services-list.tsx`, `src/app/(dashboard)/services/page.tsx` (modify) | `linkBase` prop + button per active row |
| `src/features/rentals/components/offerings-list.tsx`, `src/app/(dashboard)/rentals/page.tsx` (modify) | same |
| `src/app/(dashboard)/embed/page.tsx` (modify) | renders `LinksTable` under the appearance editor |
| `src/features/orgs/admin-copy.test.ts` (modify) | `SURFACES` gains `links-table.tsx`, `copy-link-button.tsx` |

---

### Task 1: Pure seams — channel filter, link targets, snippet, deep-link resolvers, page request, vocab, link rows

**Files:**
- Create: `src/lib/booking/channel.ts`, `src/lib/booking/channel.test.ts`
- Modify: `src/lib/booking/url.ts`, `src/lib/booking/url.test.ts`
- Modify: `src/features/orgs/components/widget-embed-snippet.ts`, `src/features/orgs/components/widget-embed-snippet.test.ts`, `src/features/orgs/components/widget-appearance.tsx` (line ≈ 75)
- Modify: `src/features/booking-page/initial-service.ts`, `src/features/booking-page/initial-service.test.ts`
- Modify: `src/features/booking-page/render/page-request.ts`, `src/features/booking-page/render/page-request.test.ts`
- Modify: `src/features/orgs/vocab.ts`, `src/features/orgs/vocab.test.ts`
- Create: `src/features/orgs/link-rows.ts`, `src/features/orgs/link-rows.test.ts`

**Interfaces:**
- Consumes: `bookingUrl(appUrl, handle, staffSlug?)` (exists in `url.ts`), `embedTitle(mode?)` (exists in `widget-embed-snippet.ts`), `OrgMode` (`orgs/mode.ts`), `SPACES`/`APPOINTMENTS` (`orgs/vocab.ts`).
- Produces (Tasks 2 and 3 rely on these exact names):

```ts
// lib/booking/channel.ts
export type Channel = "services" | "spaces";
export function resolveChannelParam(param: string | string[] | undefined): Channel | null;
export type ChannelCatalog<S, T, O> = { services: S[]; staff: T[]; serviceStaffIds: Record<string, string[]>; offerings: O[] };
export function applyChannel<S, T, O>(cat: ChannelCatalog<S, T, O>, channel: Channel | null): ChannelCatalog<S, T, O>;
// lib/booking/url.ts (added)
export type LinkTarget = { service: string } | { space: string } | { staff: string } | { channel: Channel } | null;
export function targetQuery(target?: LinkTarget): string;            // "?service=…" | "?space=…" | "?channel=…" | "" (staff handled by the callers)
export function bookingLink(appUrl: string, handle: string, target?: LinkTarget): string;
export function embedSrc(appUrl: string, handle: string, target?: LinkTarget): string;
// orgs/components/widget-embed-snippet.ts
export function embedSnippet(appUrl: string, handle: string, target?: LinkTarget, mode?: OrgMode): string;   // snippetFor is removed
// booking-page/initial-service.ts (added)
export function resolveInitialOffering(offerings: ReadonlyArray<{ id: string }>, param: string | string[] | undefined): string | null;
// booking-page/render/page-request.ts (changed signature)
export function initialRequest(serviceId: string | null, offeringId?: string | null): PageRequest;   // service wins over offering
// orgs/vocab.ts (added)
SPACES.only === "Spaces only"; APPOINTMENTS.only === "Appointments only";
// orgs/link-rows.ts
export type LinkRow = { key: string; label: string; badge: string | null; target: LinkTarget };
export function linkRows(input: { mode: OrgMode; staff: readonly { slug: string; name: string }[]; services: readonly { id: string; name: string }[]; spaces: readonly { id: string; name: string }[] }): LinkRow[];
```

- [ ] **Step 1: Channel filter — failing test**

Create `src/lib/booking/channel.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { applyChannel, resolveChannelParam } from "./channel";

const svc = { id: "s1" };
const person = { id: "p1" };
const room = { id: "o1" };
const both = { services: [svc], staff: [person], serviceStaffIds: { s1: ["p1"] }, offerings: [room] };

describe("resolveChannelParam (spec §5 — one channel only)", () => {
  it("accepts exactly services or spaces", () => {
    expect(resolveChannelParam("services")).toBe("services");
    expect(resolveChannelParam("spaces")).toBe("spaces");
  });
  it("anything else is null: other words, case, arrays, absence", () => {
    expect(resolveChannelParam("rooms")).toBeNull();
    expect(resolveChannelParam("Services")).toBeNull();
    expect(resolveChannelParam(["services"])).toBeNull();
    expect(resolveChannelParam(undefined)).toBeNull();
  });
});

describe("applyChannel", () => {
  it("services: drops the spaces; spaces: drops services, staff and the staff map", () => {
    expect(applyChannel(both, "services")).toEqual({ ...both, offerings: [] });
    expect(applyChannel(both, "spaces")).toEqual({ services: [], staff: [], serviceStaffIds: {}, offerings: [room] });
  });
  it("no channel: the catalogue is returned as-is", () => {
    expect(applyChannel(both, null)).toBe(both);
  });
  it("degrades to the full catalogue when the requested channel has nothing in it (never an empty widget)", () => {
    const spacesOnly = { ...both, services: [], staff: [], serviceStaffIds: {} };
    expect(applyChannel(spacesOnly, "services")).toBe(spacesOnly);
    const servicesOnly = { ...both, offerings: [] };
    expect(applyChannel(servicesOnly, "spaces")).toBe(servicesOnly);
  });
});
```

Run: `npx vitest run src/lib/booking/channel.test.ts` → FAIL ("Failed to resolve import ./channel").

- [ ] **Step 2: Implement `channel.ts`**

Create `src/lib/booking/channel.ts`:

```ts
/* `?channel=services|spaces` (admin IA spec §5, ruling 7): one link that
   shows one channel of the public catalogue. Pure — the two public routes
   apply it to the gated catalogue BEFORE the widget, its group headings and
   the builder sections read it, so all of them agree. Degrades by what the
   catalogue actually holds: a channel with nothing in it (mode off, feature
   flag off, or simply nothing active) yields the full catalogue — never a
   404, never an empty widget. */
export type Channel = "services" | "spaces";

export function resolveChannelParam(param: string | string[] | undefined): Channel | null {
  return param === "services" || param === "spaces" ? param : null;
}

export type ChannelCatalog<S, T, O> = {
  services: S[];
  staff: T[];
  serviceStaffIds: Record<string, string[]>;
  offerings: O[];
};

export function applyChannel<S, T, O>(cat: ChannelCatalog<S, T, O>, channel: Channel | null): ChannelCatalog<S, T, O> {
  if (channel === "services" && cat.services.length > 0) return { ...cat, offerings: [] };
  if (channel === "spaces" && cat.offerings.length > 0) return { ...cat, services: [], staff: [], serviceStaffIds: {} };
  return cat;
}
```

Run: `npx vitest run src/lib/booking/channel.test.ts` → PASS (5 tests).

- [ ] **Step 3: Link targets — failing tests**

Append to the `describe("booking URLs", …)` block in `src/lib/booking/url.test.ts` (and extend its import to `{ bookingLink, bookingPath, bookingUrl, embedSrc, hostLabel, targetQuery }`):

```ts
  it("targetQuery renders the three query targets, nothing for staff/none", () => {
    expect(targetQuery({ service: "s1" })).toBe("?service=s1");
    expect(targetQuery({ space: "o1" })).toBe("?space=o1");
    expect(targetQuery({ channel: "spaces" })).toBe("?channel=spaces");
    expect(targetQuery({ staff: "anna" })).toBe("");
    expect(targetQuery(null)).toBe("");
    expect(targetQuery()).toBe("");
  });
  it("bookingLink: a staff target is a path segment, everything else a query on the page", () => {
    expect(bookingLink("https://booklo.co", "anna")).toBe("https://booklo.co/anna");
    expect(bookingLink("https://booklo.co/", "anna", { staff: "maria" })).toBe("https://booklo.co/anna/maria");
    expect(bookingLink("https://booklo.co", "anna", { service: "s1" })).toBe("https://booklo.co/anna?service=s1");
    expect(bookingLink("https://booklo.co", "anna", { space: "o1" })).toBe("https://booklo.co/anna?space=o1");
    expect(bookingLink("https://booklo.co", "anna", { channel: "services" })).toBe("https://booklo.co/anna?channel=services");
  });
  it("embedSrc: every target is a query on the embed route", () => {
    expect(embedSrc("https://booklo.co", "anna")).toBe("https://booklo.co/embed/anna");
    expect(embedSrc("https://booklo.co/", "anna", { staff: "maria" })).toBe("https://booklo.co/embed/anna?staff=maria");
    expect(embedSrc("https://booklo.co", "anna", { space: "o1" })).toBe("https://booklo.co/embed/anna?space=o1");
    expect(embedSrc("https://booklo.co", "anna", { channel: "spaces" })).toBe("https://booklo.co/embed/anna?channel=spaces");
  });
```

Run: `npx vitest run src/lib/booking/url.test.ts` → FAIL (`targetQuery` is not exported).

- [ ] **Step 4: Implement the url.ts additions**

Append to `src/lib/booking/url.ts`:

```ts
import type { Channel } from "./channel";

/* Per-thing links (admin IA spec §5): what a link or embed opens on. A
   staff target is a path segment on the hosted page (/<handle>/<slug>) and
   a `?staff=` query on the embed — the two builders below know which;
   everything else is the same query on both. Slugged short links for
   services/spaces need a migration and stay deferred. */
export type LinkTarget =
  | { service: string }
  | { space: string }
  | { staff: string }
  | { channel: Channel }
  | null;

export function targetQuery(target?: LinkTarget): string {
  if (!target) return "";
  if ("service" in target) return `?service=${encodeURIComponent(target.service)}`;
  if ("space" in target) return `?space=${encodeURIComponent(target.space)}`;
  if ("channel" in target) return `?channel=${target.channel}`;
  return "";
}

export function bookingLink(appUrl: string, handle: string, target?: LinkTarget): string {
  if (target && "staff" in target) return bookingUrl(appUrl, handle, target.staff);
  return `${bookingUrl(appUrl, handle)}${targetQuery(target)}`;
}

export function embedSrc(appUrl: string, handle: string, target?: LinkTarget): string {
  const base = `${appUrl.replace(/\/+$/, "")}/embed/${handle}`;
  if (target && "staff" in target) return `${base}?staff=${encodeURIComponent(target.staff)}`;
  return `${base}${targetQuery(target)}`;
}
```

(The `import type` may sit at the top of the file with the existing header comment — ESLint's import ordering is not enforced here, but put it first for tidiness.)

Run: `npx vitest run src/lib/booking/url.test.ts` → PASS (the `/book/` literal guard in that file still passes — nothing above builds `/book/`).

- [ ] **Step 5: `embedSnippet` — rewrite the test file, then the module and its one caller**

Replace `src/features/orgs/components/widget-embed-snippet.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
import { embedSnippet } from "./widget-embed-snippet";

const APP = "https://app.example.com";
const APPTS_ONLY = { offersAppointments: true, offersRentals: false };
const RENTALS_ONLY = { offersAppointments: false, offersRentals: true };
const BOTH = { offersAppointments: true, offersRentals: true };

describe("embedSnippet", () => {
  const snippet = embedSnippet(APP, "acme-studio");

  it("interpolates appUrl and handle into the iframe src", () => {
    expect(snippet).toContain('src="https://app.example.com/embed/acme-studio"');
  });
  it("interpolates appUrl into the script src", () => {
    expect(snippet).toContain('src="https://app.example.com/embed.js"');
  });
  it("carries the data-rollout-embed attribute embed.js selects iframes by", () => {
    expect(snippet).toContain("data-rollout-embed");
  });
  it("marks the script async so the pasted snippet doesn't parser-block the host page", () => {
    expect(snippet).toMatch(/<script src="[^"]+" async><\/script>/);
  });
  it("is byte-identical for a null target (whole-team embed)", () => {
    expect(embedSnippet(APP, "acme-studio", null)).toBe(snippet);
    expect(snippet).not.toContain("?");
  });
});

describe("embedSnippet targets (spec §5)", () => {
  it("staff pins the embed via ?staff=<slug> and leaves the script src alone", () => {
    const s = embedSnippet(APP, "acme-studio", { staff: "anna" });
    expect(s).toContain('src="https://app.example.com/embed/acme-studio?staff=anna"');
    expect(s).toContain('src="https://app.example.com/embed.js"');
  });
  it("service, space and channel become the matching query", () => {
    expect(embedSnippet(APP, "acme", { service: "s1" })).toContain('src="https://app.example.com/embed/acme?service=s1"');
    expect(embedSnippet(APP, "acme", { space: "o1" })).toContain('src="https://app.example.com/embed/acme?space=o1"');
    expect(embedSnippet(APP, "acme", { channel: "services" })).toContain('src="https://app.example.com/embed/acme?channel=services"');
  });
});

describe("embedSnippet iframe title", () => {
  it("no target: follows the org's channels, historical default without a mode", () => {
    expect(embedSnippet(APP, "acme", null, APPTS_ONLY)).toContain('title="Book an appointment"');
    expect(embedSnippet(APP, "acme", null, RENTALS_ONLY)).toContain('title="Book a space"');
    expect(embedSnippet(APP, "acme", null, BOTH)).toContain('title="Book online"');
    expect(embedSnippet(APP, "acme")).toContain('title="Book an appointment"');
  });
  it("a target names its own channel, whatever the org's mode", () => {
    expect(embedSnippet(APP, "acme", { space: "o1" }, BOTH)).toContain('title="Book a space"');
    expect(embedSnippet(APP, "acme", { channel: "spaces" }, BOTH)).toContain('title="Book a space"');
    expect(embedSnippet(APP, "acme", { service: "s1" }, BOTH)).toContain('title="Book an appointment"');
    expect(embedSnippet(APP, "acme", { staff: "anna" }, BOTH)).toContain('title="Book an appointment"');
    expect(embedSnippet(APP, "acme", { channel: "services" }, RENTALS_ONLY)).toContain('title="Book an appointment"');
  });
});
```

Run: `npx vitest run src/features/orgs/components/widget-embed-snippet.test.ts` → FAIL (`embedSnippet` not exported).

Replace `src/features/orgs/components/widget-embed-snippet.ts` with:

```ts
import type { OrgMode } from "@/features/orgs/mode";
import { embedSrc, type LinkTarget } from "@/lib/booking/url";

// Pure string builder, split out of widget-appearance.tsx so it's
// unit-testable without pulling in that "use client" component's React /
// next/font dependency graph (vitest's test.include only covers *.test.ts,
// not *.tsx).
//
// Shape mirrors the spec's snippet block verbatim (design doc, "Snippet
// UI"): `data-rollout-embed` is load-bearing — public/embed.js selects
// iframes via `iframe[data-rollout-embed]` — and `async` on the script tag
// keeps the pasted snippet from parser-blocking the customer's page.
//
// The `target` (admin IA spec §5) pins the embed to one person, one
// service, one space or one channel — `embedSrc` builds the query. A null
// target is the whole-catalogue embed, byte-identical to what solo orgs
// have always pasted.
//
// The iframe `title` is the widget's accessible name on the host page. With
// a target it names that target's channel; without one it follows the org's
// channels (embedTitle), and omitting `mode` keeps the historical
// appointments title.
export function embedTitle(mode?: OrgMode): string {
  if (!mode || (mode.offersAppointments && !mode.offersRentals)) return "Book an appointment";
  return mode.offersRentals && !mode.offersAppointments ? "Book a space" : "Book online";
}

function snippetTitle(target: LinkTarget | undefined, mode: OrgMode | undefined): string {
  if (target && ("space" in target || ("channel" in target && target.channel === "spaces"))) return "Book a space";
  if (target) return "Book an appointment";
  return embedTitle(mode);
}

export function embedSnippet(appUrl: string, handle: string, target?: LinkTarget, mode?: OrgMode): string {
  const scriptBase = appUrl.replace(/\/+$/, "");
  return (
    `<iframe data-rollout-embed src="${embedSrc(appUrl, handle, target)}" `
    + `style="width:100%;border:0" title="${snippetTitle(target, mode)}"></iframe>\n`
    + `<script src="${scriptBase}/embed.js" async></script>`
  );
}
```

In `src/features/orgs/components/widget-appearance.tsx` change the import `import { snippetFor } from "./widget-embed-snippet";` to `import { embedSnippet } from "./widget-embed-snippet";` and the line (≈ 75)

```ts
  const snippet = handle ? snippetFor(appUrl, handle, staffSlug || null, mode) : "";
```

to

```ts
  const snippet = handle ? embedSnippet(appUrl, handle, staffSlug ? { staff: staffSlug } : null, mode) : "";
```

Then confirm nothing else imports the old name: `grep -rn "snippetFor" src` → no hits.

Run: `npx vitest run src/features/orgs/components/widget-embed-snippet.test.ts` → PASS (10 tests).

- [ ] **Step 6: `resolveInitialOffering` — test, then implementation**

Replace `src/features/booking-page/initial-service.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
import { resolveInitialOffering, resolveInitialService } from "./initial-service";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const services = [{ id: A }, { id: B }];

describe("resolveInitialService", () => {
  it("returns the id when it names a listed service", () => {
    expect(resolveInitialService(services, A)).toBe(A);
  });
  it("ignores unknown ids, non-uuids, arrays and absence", () => {
    expect(resolveInitialService(services, "33333333-3333-4333-8333-333333333333")).toBeNull();
    expect(resolveInitialService(services, "preview-service")).toBeNull();
    expect(resolveInitialService(services, [A])).toBeNull();
    expect(resolveInitialService(services, undefined)).toBeNull();
  });
});

describe("resolveInitialOffering (spec §5 — ?space= mirrors ?service=)", () => {
  const offerings = [{ id: B }];
  it("returns the id when it names a listed space", () => {
    expect(resolveInitialOffering(offerings, B)).toBe(B);
  });
  it("an id from the other list, a non-uuid, an array or absence is null", () => {
    expect(resolveInitialOffering(offerings, A)).toBeNull();
    expect(resolveInitialOffering(offerings, "preview-offering")).toBeNull();
    expect(resolveInitialOffering(offerings, [B])).toBeNull();
    expect(resolveInitialOffering(offerings, undefined)).toBeNull();
  });
});
```

Run: `npx vitest run src/features/booking-page/initial-service.test.ts` → FAIL.

Replace `src/features/booking-page/initial-service.ts` with:

```ts
// `?service=` / `?space=` deep links (the embed also takes `?staff=`): a uuid
// naming one item of the gated, channel-filtered catalogue, else null. Pure —
// the page passes the result into PageStateProvider (hosted page) or straight
// to the widget's request props (embed); unknown ids are simply ignored, so a
// stale link degrades to the org flow instead of 404ing.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function resolveListedId(items: ReadonlyArray<{ id: string }>, param: string | string[] | undefined): string | null {
  if (typeof param !== "string" || !UUID_RE.test(param)) return null;
  return items.some((s) => s.id === param) ? param : null;
}

export function resolveInitialService(
  services: ReadonlyArray<{ id: string }>,
  param: string | string[] | undefined,
): string | null {
  return resolveListedId(services, param);
}

export function resolveInitialOffering(
  offerings: ReadonlyArray<{ id: string }>,
  param: string | string[] | undefined,
): string | null {
  return resolveListedId(offerings, param);
}
```

Run: `npx vitest run src/features/booking-page/initial-service.test.ts` → PASS (4 tests).

- [ ] **Step 7: `initialRequest(serviceId, offeringId)` — test, then implementation**

In `src/features/booking-page/render/page-request.test.ts` replace the first `it(...)` with:

```ts
  it("starts from the ?service= deep link, else ?space=, else empty; service wins when both are given", () => {
    expect(initialRequest("svc1")).toEqual({ kind: "service", id: "svc1", key: 1 });
    expect(initialRequest(null, "off1")).toEqual({ kind: "offering", id: "off1", key: 1 });
    expect(initialRequest("svc1", "off1")).toEqual({ kind: "service", id: "svc1", key: 1 });
    expect(initialRequest(null)).toBeNull();
    expect(initialRequest(null, null)).toBeNull();
  });
```

Run: `npx vitest run src/features/booking-page/render/page-request.test.ts` → FAIL.

In `src/features/booking-page/render/page-request.ts` replace `initialRequest` with:

```ts
export function initialRequest(serviceId: string | null, offeringId: string | null = null): PageRequest {
  if (serviceId) return { kind: "service", id: serviceId, key: 1 };
  if (offeringId) return { kind: "offering", id: offeringId, key: 1 };
  return null;
}
```

Run: `npx vitest run src/features/booking-page/render/page-request.test.ts` → PASS.

- [ ] **Step 8: Vocab keys — test, then strings**

Append to the `describe("SPACES vocabulary", …)` block in `src/features/orgs/vocab.test.ts`:

```ts
  it("names the per-channel link rows (spec §5)", () => {
    expect(SPACES.only).toBe("Spaces only");
    expect(APPOINTMENTS.only).toBe("Appointments only");
  });
```

Run: `npx vitest run src/features/orgs/vocab.test.ts` → FAIL.

In `src/features/orgs/vocab.ts` add, after `hoursNightsOnly` inside `SPACES`:

```ts
  /** Links & embeds row: the widget restricted to this channel (?channel=spaces). */
  only: "Spaces only",
```

and inside `APPOINTMENTS`, after `field`:

```ts
  /** Links & embeds row: the widget restricted to this channel (?channel=services). */
  only: "Appointments only",
```

Run: `npx vitest run src/features/orgs/vocab.test.ts` → PASS.

- [ ] **Step 9: `linkRows` — failing test**

Create `src/features/orgs/link-rows.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { linkRows } from "./link-rows";

const BOTH = { offersAppointments: true, offersRentals: true };
const APPTS = { offersAppointments: true, offersRentals: false };
const RENTALS = { offersAppointments: false, offersRentals: true };
const staff = [{ slug: "anna", name: "Anna" }, { slug: "ben", name: "Ben" }];
const services = [{ id: "s1", name: "Massage" }];
const spaces = [{ id: "o1", name: "Room A" }];

describe("linkRows (spec §5 — the Links & embeds table)", () => {
  it("both modes: page, the two channel rows, people, services, spaces — in that order", () => {
    const rows = linkRows({ mode: BOTH, staff, services, spaces });
    expect(rows.map((r) => r.label)).toEqual(["Whole booking page", "Appointments only", "Spaces only", "Anna", "Ben", "Massage", "Room A"]);
    expect(rows.map((r) => r.badge)).toEqual([null, null, null, "Team", "Team", "Service", "Space"]);
    expect(rows.map((r) => r.target)).toEqual([
      null, { channel: "services" }, { channel: "spaces" }, { staff: "anna" }, { staff: "ben" }, { service: "s1" }, { space: "o1" },
    ]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });
  it("single-mode orgs get no channel rows and only their own things", () => {
    expect(linkRows({ mode: APPTS, staff, services, spaces }).map((r) => r.label)).toEqual(["Whole booking page", "Anna", "Ben", "Massage"]);
    expect(linkRows({ mode: RENTALS, staff, services, spaces }).map((r) => r.label)).toEqual(["Whole booking page", "Room A"]);
  });
  it("a solo team lists no people (the caller passes [] then); nothing else changes", () => {
    expect(linkRows({ mode: BOTH, staff: [], services, spaces }).map((r) => r.label)).toEqual([
      "Whole booking page", "Appointments only", "Spaces only", "Massage", "Room A",
    ]);
  });
});
```

Run: `npx vitest run src/features/orgs/link-rows.test.ts` → FAIL.

- [ ] **Step 10: Implement `link-rows.ts`**

Create `src/features/orgs/link-rows.ts`:

```ts
import type { OrgMode } from "@/features/orgs/mode";
import { APPOINTMENTS, SPACES } from "@/features/orgs/vocab";
import type { LinkTarget } from "@/lib/booking/url";

/* The Links & embeds table as data (admin IA spec §5): one row per thing a
   client can be sent to. Pure — the page hands in ACTIVE people (only when
   the team has more than one; a solo team's link is the page), ACTIVE
   services and ACTIVE spaces, already filtered; the component turns each
   row into a link (bookingLink) and a snippet (embedSnippet). */
export type LinkRow = { key: string; label: string; badge: string | null; target: LinkTarget };

export function linkRows(input: {
  mode: OrgMode;
  staff: readonly { slug: string; name: string }[];
  services: readonly { id: string; name: string }[];
  spaces: readonly { id: string; name: string }[];
}): LinkRow[] {
  const { mode } = input;
  const rows: LinkRow[] = [{ key: "page", label: "Whole booking page", badge: null, target: null }];
  if (mode.offersAppointments && mode.offersRentals) {
    rows.push({ key: "channel:services", label: APPOINTMENTS.only, badge: null, target: { channel: "services" } });
    rows.push({ key: "channel:spaces", label: SPACES.only, badge: null, target: { channel: "spaces" } });
  }
  if (mode.offersAppointments) {
    for (const p of input.staff) rows.push({ key: `staff:${p.slug}`, label: p.name, badge: "Team", target: { staff: p.slug } });
    for (const s of input.services) rows.push({ key: `service:${s.id}`, label: s.name, badge: "Service", target: { service: s.id } });
  }
  if (mode.offersRentals) {
    for (const o of input.spaces) rows.push({ key: `space:${o.id}`, label: o.name, badge: SPACES.badge, target: { space: o.id } });
  }
  return rows;
}
```

Run: `npx vitest run src/features/orgs/link-rows.test.ts` → PASS (3 tests).

- [ ] **Step 11: Typecheck, lint, commit**

Run: `npm run typecheck && npx eslint src/lib/booking/channel.ts src/lib/booking/channel.test.ts src/lib/booking/url.ts src/lib/booking/url.test.ts src/features/orgs/components/widget-embed-snippet.ts src/features/orgs/components/widget-embed-snippet.test.ts src/features/orgs/components/widget-appearance.tsx src/features/booking-page/initial-service.ts src/features/booking-page/initial-service.test.ts src/features/booking-page/render/page-request.ts src/features/booking-page/render/page-request.test.ts src/features/orgs/vocab.ts src/features/orgs/vocab.test.ts src/features/orgs/link-rows.ts src/features/orgs/link-rows.test.ts && npx vitest run src/lib/booking src/features/orgs src/features/booking-page`
Expected: clean; all three suites pass.

```bash
git add src/lib/booking/channel.ts src/lib/booking/channel.test.ts src/lib/booking/url.ts src/lib/booking/url.test.ts src/features/orgs/components/widget-embed-snippet.ts src/features/orgs/components/widget-embed-snippet.test.ts src/features/orgs/components/widget-appearance.tsx src/features/booking-page/initial-service.ts src/features/booking-page/initial-service.test.ts src/features/booking-page/render/page-request.ts src/features/booking-page/render/page-request.test.ts src/features/orgs/vocab.ts src/features/orgs/vocab.test.ts src/features/orgs/link-rows.ts src/features/orgs/link-rows.test.ts
git commit -m "feat(links): pure seams — channel filter, link targets, embedSnippet, ?space= resolver, page request, link rows

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Public deep links — `?space=` and `?channel=` on the hosted page, `?service=` / `?space=` / `?channel=` on the embed

**Files:**
- Modify: `src/features/booking-page/render/page-state.tsx`
- Modify: `src/features/booking-page/render/page-renderer.tsx` (line ≈ 52 signature, ≈ 60 provider)
- Modify: `src/app/[handle]/page.tsx`
- Modify: `src/app/embed/[handle]/page.tsx`

**Interfaces:**
- Consumes (Task 1): `resolveChannelParam`, `applyChannel` (`@/lib/booking/channel`); `resolveInitialService`, `resolveInitialOffering` (`@/features/booking-page/initial-service`); `initialRequest(serviceId, offeringId)` (`@/features/booking-page/render/page-request`). Existing: `filterBookableServices(services, serviceStaffIds, staff, staffId)` (`@/lib/booking/bookable`), `BookingWidget` props `requestedService` / `requestedOffering: { id: string; key: number } | null` (applied once per key; the widget's applied-key state starts at `null`, so key `1` applies on first render).
- Produces: `PageRenderer` prop `initialOfferingId?: string | null`; `PageStateProvider` prop `initialOfferingId?: string | null`.

- [ ] **Step 1: Page state carries the offering deep link**

In `src/features/booking-page/render/page-state.tsx` change the provider signature and the initial state:

```tsx
/* Services / Spaces section → booking widget hand-off (see page-request.ts).
   `initialServiceId` / `initialOfferingId` are the `?service=` / `?space=`
   deep links, already resolved against the catalogue by the page. */
export function PageStateProvider({
  initialServiceId,
  initialOfferingId = null,
  children,
}: {
  initialServiceId: string | null;
  initialOfferingId?: string | null;
  children: React.ReactNode;
}) {
  const [requested, setRequested] = React.useState<PageRequest>(() => initialRequest(initialServiceId, initialOfferingId));
```

(the rest of the component is unchanged).

In `src/features/booking-page/render/page-renderer.tsx` change the `PageRenderer` signature (≈ line 52) to

```tsx
export function PageRenderer({
  doc,
  ctx,
  initialServiceId = null,
  initialOfferingId = null,
}: {
  doc: PageDocument;
  ctx: RenderContext;
  initialServiceId?: string | null;
  initialOfferingId?: string | null;
}) {
```

and the provider element (≈ line 60) to

```tsx
    <PageStateProvider initialServiceId={initialServiceId} initialOfferingId={initialOfferingId}>
```

- [ ] **Step 2: Hosted page — `?channel=` filters the context, `?space=` seeds the widget**

In `src/app/[handle]/page.tsx`:

Add the imports

```ts
import { resolveInitialOffering, resolveInitialService } from "@/features/booking-page/initial-service";
import { applyChannel, resolveChannelParam } from "@/lib/booking/channel";
```

(replacing the existing `resolveInitialService` import line), and replace the block from `const { services, staff, serviceStaffIds } = offering;` through the `ctx` literal with:

```ts
  if (offering.services.length === 0 && offerings.length === 0) notFound();
  const theme = parseWidgetTheme(branding.themeRaw);
  const sp = await searchParams;
  // `?channel=services|spaces` (spec §5, ruling 7): one channel of the gated
  // catalogue — applied here, before the widget, its headings and the
  // builder's Services / Spaces / Staff sections read it, so they all agree
  // (publicSections drops the emptied sections). A channel with nothing in
  // it degrades to the whole catalogue.
  const cat = applyChannel(
    { services: offering.services, staff: offering.staff, serviceStaffIds: offering.serviceStaffIds, offerings },
    resolveChannelParam(sp.channel),
  );
  const { services, staff, serviceStaffIds } = cat;
  // `?service=` / `?space=`: resolved against what this link shows.
  const initialServiceId = resolveInitialService(services, sp.service);
  const initialOfferingId = resolveInitialOffering(cat.offerings, sp.space);
  const ctx: RenderContext = {
    org: { orgId: org.orgId, orgName: org.orgName, handle, timeZone: org.timeZone, currency: org.currency },
    branding: { accentColor: branding.accentColor, logoUrl: branding.logoUrl },
    theme, services, staff, serviceStaffIds, offerings: cat.offerings, lockedStaff: null,
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL, mode: "public",
  };
```

and the renderer element to

```tsx
          <PageRenderer doc={doc} ctx={ctx} initialServiceId={initialServiceId} initialOfferingId={initialOfferingId} />
```

(`services`/`staff`/`serviceStaffIds` must no longer be destructured from `offering` above — the `notFound()` guard reads `offering.services` directly, as shown.)

- [ ] **Step 3: Embed — `?channel=`, then the staff pin, then `?service=` / `?space=`**

In `src/app/embed/[handle]/page.tsx` add the imports

```ts
import { resolveInitialOffering, resolveInitialService } from "@/features/booking-page/initial-service";
import { initialRequest } from "@/features/booking-page/render/page-request";
import { applyChannel, resolveChannelParam } from "@/lib/booking/channel";
```

and replace the block from `const { services: orgServices, staff, serviceStaffIds } = offering;` through `const services = lockedStaff ? pinnedServices : orgServices;` with:

```ts
  if (offering.services.length === 0 && offerings.length === 0) notFound();
  const sp = await searchParams;
  // `?channel=` first (spec §5): the pin below only sees the channel this
  // snippet shows, so `?channel=spaces&staff=anna` is a spaces widget with
  // no lock. A channel with nothing in it degrades to the whole catalogue.
  const cat = applyChannel(
    { services: offering.services, staff: offering.staff, serviceStaffIds: offering.serviceStaffIds, offerings },
    resolveChannelParam(sp.channel),
  );
  const { services: orgServices, staff, serviceStaffIds } = cat;
  // `?staff=` pins the embed to one team member. Unlike /[handle]/[slug]
  // this never 404s: the snippet lives on someone else's site, so a staff
  // member who left (or a mistyped slug) must degrade to the org-wide flow
  // rather than break the host page. Resolved from the plan's roster, so a
  // person the plan no longer offers degrades the same way. Shape-checked
  // before it is used at all.
  const staffParam = sp.staff;
  const staffSlug = typeof staffParam === "string" && STAFF_SLUG_RE.test(staffParam) ? staffParam : null;
  const pinnedStaff = staffSlug ? staff.find((s) => s.slug === staffSlug) ?? null : null;
  // Same reasoning one level down: a pinned person who offers nothing (every
  // service unlinked from them since the snippet was copied) would leave the
  // widget with an empty service step. Drop the lock and show the org flow —
  // the embed degrades, it never breaks.
  const pinnedServices = pinnedStaff
    ? filterBookableServices(orgServices, serviceStaffIds, staff, pinnedStaff.id)
    : [];
  const lockedStaff = pinnedServices.length > 0 ? pinnedStaff : null;
  const services = lockedStaff ? pinnedServices : orgServices;
  // `?service=` / `?space=` (spec §5): the pinned roster wins — a service the
  // pinned person doesn't offer is ignored. The widget applies a request once
  // per key; key 1 lands on first render, exactly like the hosted page.
  const requested = initialRequest(
    resolveInitialService(services, sp.service),
    resolveInitialOffering(cat.offerings, sp.space),
  );
```

(the `staffParam` line that awaited `searchParams` a second time is gone — `sp` is awaited once). Then pass the request and the filtered lists to the widget:

```tsx
      <BookingWidget
        handle={handle}
        orgTimeZone={org.timeZone}
        currency={org.currency}
        services={services}
        offerings={cat.offerings}
        staff={staff}
        serviceStaffIds={serviceStaffIds}
        lockedStaff={lockedStaff}
        requestedService={requested?.kind === "service" ? requested : null}
        requestedOffering={requested?.kind === "offering" ? requested : null}
      />
```

- [ ] **Step 4: Typecheck, lint, unit suites, browser check, commit**

Run: `npm run typecheck && npx eslint src/features/booking-page/render/page-state.tsx src/features/booking-page/render/page-renderer.tsx "src/app/[handle]/page.tsx" "src/app/embed/[handle]/page.tsx" && npx vitest run src/features/booking-page src/lib/booking`
Expected: clean.

Browser check (dev server `npx next dev -p 3001 --webpack`, **http://localhost:3001**; the demo org's handle is on `/booking-page` — take it from there; the demo org has services, two staff, one hourly space "Rehearsal Room" and one nightly space "Test"):

| URL | expected |
|---|---|
| `/<handle>?space=<Rehearsal Room id>` | the widget opens on that space (duration pills / slot grid), the page's other sections render |
| `/<handle>?service=<service id>` | still opens on the service (regression) |
| `/<handle>?space=not-a-uuid`, `/<handle>?space=<a service id>` | plain org page, no error |
| `/<handle>?channel=spaces` | no Services section, no Staff section, widget lists spaces only with **no** group heading |
| `/<handle>?channel=services` | no Spaces section, widget lists services only, no heading |
| `/<handle>?channel=rooms` | full page |
| `/embed/<handle>?space=<id>`, `?service=<id>`, `?channel=services`, `?channel=spaces` | same behaviours inside the bare widget |
| `/embed/<handle>?staff=<slug>&service=<a service that person offers>` | locked to the person AND opened on the service; with a service they don't offer → locked, service step shown |
| `/embed/<handle>?staff=<slug>&channel=spaces` | spaces only, no lock |
| Settings › Business: untick Spaces, then `/<handle>?channel=spaces` | full appointments page (degrade); re-tick Spaces |

Stop the dev server; the demo org must be back on Both.

```bash
git add src/features/booking-page/render/page-state.tsx src/features/booking-page/render/page-renderer.tsx "src/app/[handle]/page.tsx" "src/app/embed/[handle]/page.tsx"
git commit -m "feat(links): ?space= and ?channel= on the hosted page; ?service=, ?space= and ?channel= on the embed

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Admin — Copy link on Services and Spaces rows, the Links & embeds table

**Files:**
- Create: `src/lib/clipboard.ts`
- Create: `src/components/copy-link-button.tsx`
- Create: `src/features/orgs/components/links-table.tsx`
- Modify: `src/features/scheduling/components/services-list.tsx`, `src/app/(dashboard)/services/page.tsx`
- Modify: `src/features/rentals/components/offerings-list.tsx`, `src/app/(dashboard)/rentals/page.tsx`
- Modify: `src/app/(dashboard)/embed/page.tsx`
- Modify: `src/features/orgs/admin-copy.test.ts` (`SURFACES`)

**Interfaces:**
- Consumes (Task 1): `bookingLink`, `embedSnippet`, `linkRows`, `LinkRow`, `SPACES.badge`. Existing: `getSchedulingSettings()` → `{ handle: string | null, … } | null` (`@/features/orgs/queries`), `env.NEXT_PUBLIC_APP_URL` (`@/env`), `Button` (`size="xs"`, `variant="ghost"` — as `staff-list.tsx`), `Badge`, `toast` (sonner), `HugeiconsIcon` + `Link01Icon`.
- Produces:

```ts
// lib/clipboard.ts
export async function copyText(text: string): Promise<boolean>;     // awaited write; false when refused
// components/copy-link-button.tsx
export function CopyLinkButton(props: { url: string }): JSX.Element;
// orgs/components/links-table.tsx
export function LinksTable(props: { appUrl: string; handle: string; mode: OrgMode; staff: { slug: string; name: string }[]; services: { id: string; name: string }[]; spaces: { id: string; name: string }[] }): JSX.Element;
// lists
export type LinkBase = { appUrl: string; handle: string };   // exported from copy-link-button.tsx
ServicesList props gain `linkBase: LinkBase | null`; OfferingsList props gain `linkBase: LinkBase | null`.
```

- [ ] **Step 1: The shared clipboard write**

Create `src/lib/clipboard.ts`:

```ts
/* One awaited clipboard write. The write can be refused (permissions,
   insecure context, no focus) and a button must not claim "Copied" when it
   was — portal-links-panel.tsx / staff-list.tsx precedent, shared here for
   the copy-link controls the admin IA slice adds. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: `CopyLinkButton`**

Create `src/components/copy-link-button.tsx`:

```tsx
"use client";

import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";

/** What a list row needs to build its own booking link; null when the org
    has no handle yet (then no row shows a button). */
export type LinkBase = { appUrl: string; handle: string };

export const COPY_REFUSED = "Couldn't copy — select the link text and copy manually.";

/* "Copy link" on a Services / Spaces row (admin IA spec §5): the Team page's
   ghost button idiom, plus a link glyph so the row reads at a glance. */
export function CopyLinkButton({ url }: { url: string }) {
  const copy = async () => {
    if (await copyText(url)) toast.success("Copied");
    else toast.error(COPY_REFUSED);
  };
  return (
    <Button variant="ghost" size="xs" onClick={copy} aria-label="Copy booking link">
      <HugeiconsIcon icon={Link01Icon} size={14} className="shrink-0" aria-hidden />
      Copy link
    </Button>
  );
}
```

- [ ] **Step 3: Services rows**

In `src/features/scheduling/components/services-list.tsx`:

Add the imports

```ts
import { bookingLink } from "@/lib/booking/url";
import { CopyLinkButton, type LinkBase } from "@/components/copy-link-button";
```

Change `Row`'s signature to `function Row({ service, staff, linkBase }: { service: ServiceRow; staff: StaffRow[]; linkBase: LinkBase | null })` and, inside its action cluster (`<div className="flex shrink-0 items-center gap-2">`), insert **before** `<ServiceDialog …/>`:

```tsx
        {/* Only a live service is worth a link — an inactive one would just
            degrade to the org flow. No handle ⇒ no button anywhere. */}
        {linkBase && service.active ? (
          <CopyLinkButton url={bookingLink(linkBase.appUrl, linkBase.handle, { service: service.id })} />
        ) : null}
```

Change `ServicesList` to

```tsx
export function ServicesList({
  services,
  staff,
  linkBase,
}: {
  services: ServiceRow[];
  staff: StaffRow[];
  linkBase: LinkBase | null;
}) {
  return (
    <ol className="flex flex-col gap-2">
      {services.map((service) => (
        <Row key={service.id} service={service} staff={staff} linkBase={linkBase} />
      ))}
    </ol>
  );
}
```

In `src/app/(dashboard)/services/page.tsx` add

```ts
import { getSchedulingSettings } from "@/features/orgs/queries";
import { env } from "@/env";
```

fetch the settings alongside (`const [services, staff, settings] = await Promise.all([listServices(), listStaff(), getSchedulingSettings()]);`), compute

```ts
  // Copy-link buttons need the public address; before the org picks a handle
  // there is nothing to copy (spec §5: hidden when there is no handle).
  const linkBase = settings?.handle ? { appUrl: env.NEXT_PUBLIC_APP_URL, handle: settings.handle } : null;
```

and pass `linkBase={linkBase}` to `<ServicesList …/>`.

- [ ] **Step 4: Spaces rows**

In `src/features/rentals/components/offerings-list.tsx` add the same two imports, change `Row`'s signature to `function Row({ offering, currency, linkBase }: { offering: OfferingRow; currency: string; linkBase: LinkBase | null })`, insert **before** the `Units` `<Link …>` in the action cluster:

```tsx
        {linkBase && offering.active ? (
          <CopyLinkButton url={bookingLink(linkBase.appUrl, linkBase.handle, { space: offering.id })} />
        ) : null}
```

and change `OfferingsList` to take and pass `linkBase: LinkBase | null` exactly as `ServicesList` does. In `src/app/(dashboard)/rentals/page.tsx` add the same two imports, fetch `getSchedulingSettings()` (`const [offerings, currency, settings] = await Promise.all([listOfferings(), getOrgCurrency(), getSchedulingSettings()]);`), compute `linkBase` with the same comment, and pass `linkBase={linkBase}` to `<OfferingsList …/>`.

- [ ] **Step 5: `LinksTable`**

Create `src/features/orgs/components/links-table.tsx`:

```tsx
"use client";

import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { COPY_REFUSED } from "@/components/copy-link-button";
import type { OrgMode } from "@/features/orgs/mode";
import { linkRows } from "@/features/orgs/link-rows";
import { embedSnippet } from "@/features/orgs/components/widget-embed-snippet";
import { bookingLink } from "@/lib/booking/url";
import { copyText } from "@/lib/clipboard";

/* Links & embeds (admin IA spec §5): every place a client can be sent —
   the whole page, one channel, one person, one service, one space — as a
   link and as a snippet. Rows come from linkRows (pure); this component only
   builds the strings and copies them. Rendered only when the org has a
   handle (the page already handles that state). */
export function LinksTable({
  appUrl,
  handle,
  mode,
  staff,
  services,
  spaces,
}: {
  appUrl: string;
  handle: string;
  mode: OrgMode;
  staff: { slug: string; name: string }[];
  services: { id: string; name: string }[];
  spaces: { id: string; name: string }[];
}) {
  const rows = linkRows({ mode, staff, services, spaces });
  const copy = async (text: string, what: string) => {
    if (await copyText(text)) toast.success(`${what} copied`);
    else toast.error(COPY_REFUSED);
  };
  return (
    <section aria-labelledby="links-heading" className="flex flex-col gap-2">
      <h2 id="links-heading" className="text-muted-foreground text-sm font-medium">
        Links &amp; embeds
      </h2>
      <p className="text-muted-foreground text-xs">
        A link opens your booking page on that thing; an embed is the snippet for it.
      </p>
      <div className="border-border overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-border border-b last:border-b-0">
                <td className="px-3 py-2">
                  <span className="flex items-center gap-2">
                    <span className="truncate">{row.label}</span>
                    {row.badge ? <Badge variant="outline">{row.badge}</Badge> : null}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <Button variant="ghost" size="xs" onClick={() => copy(bookingLink(appUrl, handle, row.target), "Link")}>
                    Copy link
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => copy(embedSnippet(appUrl, handle, row.target, mode), "Embed")}
                  >
                    Copy embed
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
```

- [ ] **Step 6: The embed page renders it**

In `src/app/(dashboard)/embed/page.tsx` add

```ts
import { LinksTable } from "@/features/orgs/components/links-table";
```

and, after the `<WidgetAppearance … />` element inside the page's outer `<div>`, add:

```tsx
      {schedulingSettings.handle ? (
        <LinksTable
          appUrl={env.NEXT_PUBLIC_APP_URL}
          handle={schedulingSettings.handle}
          mode={mode}
          staff={staffOptions}
          services={services.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name }))}
          spaces={offerings.filter((o) => o.active).map((o) => ({ id: o.id, name: o.name }))}
        />
      ) : null}
```

(`staffOptions` is already the active roster when there is more than one person, else `[]` — the solo rule the table shares.)

- [ ] **Step 7: Copy guard, typecheck, lint, browser check, commit**

Append to `SURFACES` in `src/features/orgs/admin-copy.test.ts`:

```ts
  "src/features/orgs/components/links-table.tsx",
  "src/components/copy-link-button.tsx",
```

Run: `npx vitest run src/features/orgs/admin-copy.test.ts` → PASS (reword a comment if the guard trips; never weaken it).

Run: `npm run typecheck && npx eslint src/lib/clipboard.ts src/components/copy-link-button.tsx src/features/orgs/components/links-table.tsx src/features/scheduling/components/services-list.tsx "src/app/(dashboard)/services/page.tsx" src/features/rentals/components/offerings-list.tsx "src/app/(dashboard)/rentals/page.tsx" "src/app/(dashboard)/embed/page.tsx" src/features/orgs/admin-copy.test.ts && npx vitest run src/features/orgs`
Expected: clean.

Browser check (dev server as in Task 2, **http://localhost:3001**, `demo@rolloutos.local` / `Password123!`, Both mode): `/embed` shows **Links & embeds** with rows Whole booking page · Appointments only · Spaces only · the two people (Team badge) · each active service (Service) · Rehearsal Room and Test (Space); "Copy link" on the Rehearsal Room row toasts "Link copied" and the clipboard holds `<appUrl>/<handle>?space=<id>` (read it back with `navigator.clipboard.readText()` via `browser_evaluate`, or paste into the Settings search box); "Copy embed" on Spaces only holds a snippet whose `src` ends in `?channel=spaces` and whose title is `Book a space`. `/services` and `/rentals` rows show **Copy link**; an inactive row shows none. Stop the dev server.

```bash
git add src/lib/clipboard.ts src/components/copy-link-button.tsx src/features/orgs/components/links-table.tsx src/features/scheduling/components/services-list.tsx "src/app/(dashboard)/services/page.tsx" src/features/rentals/components/offerings-list.tsx "src/app/(dashboard)/rentals/page.tsx" "src/app/(dashboard)/embed/page.tsx" src/features/orgs/admin-copy.test.ts
git commit -m "feat(links): Links & embeds table on the Website embed page; Copy link on Services and Spaces rows

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Whole-slice verification and browser QA

- [ ] **Step 1: Full verify**

Run: `npm run verify`
Expected: lint 0 errors (1 pre-existing warning), typecheck clean, all tests pass (U3 baseline 940; this slice adds ≈ 25).

- [ ] **Step 2: Browser QA matrix**

Dev server `npx next dev -p 3001 --webpack`, browser at **http://localhost:3001**. Demo org (`demo@rolloutos.local` / `Password123!`; handle on `/booking-page`; mode via Settings › Business — restore Both at the end). Screenshots to `.playwright-mcp/u4-<mode>-<check>.png`; results to `.superpowers/sdd/<this plan's workspace>/qa-ledger.md`.

| check | expected |
|---|---|
| `/embed` table, Both | rows: Whole booking page · Appointments only · Spaces only · each person (Team) · each active service (Service) · each active space (Space); every row has Copy link + Copy embed; toasts "Link copied" / "Embed copied" |
| `/embed` table, appointments-only / rentals-only | no channel rows; only that channel's things; solo team ⇒ no people rows |
| Clipboard contents (read back via `browser_evaluate`) | page link = `<appUrl>/<handle>`; Spaces only link ends `?channel=spaces`; a person's link = `/<handle>/<slug>`, their embed src has `?staff=<slug>`; a space's embed src has `?space=<id>` and title `Book a space`; a service's embed title `Book an appointment` |
| `/services`, `/rentals` rows | Copy link on active rows only; copies `?service=` / `?space=` links; hidden entirely on an org with no handle (reason from code if no such org is handy) |
| Public `/<handle>?space=<id>` · `?service=<id>` | widget opens on that thing; other sections intact |
| Public bad params | `?space=junk`, `?space=<service id>`, `?channel=rooms` ⇒ plain page |
| Public `?channel=services` / `?channel=spaces` | only that channel's builder sections and widget group; no group heading |
| Degrade | untick Spaces → `?channel=spaces` ⇒ full appointments page; re-tick |
| Embed `?service=`, `?space=`, `?channel=` | same inside the bare widget |
| Embed `?staff=<slug>&service=<offered>` / `&service=<not offered>` / `&channel=spaces` | lock + opened · lock + service step · spaces only, no lock |
| Existing embed snippet block on `/embed` | unchanged output for whole team; "Book with" a person ⇒ `?staff=<slug>` and title `Book an appointment` |
| Keyboard | table buttons reachable in order; `aria-label="Copy booking link"` on the row buttons |

- [ ] **Step 3: Knowledge graph + wrap-up**

Run: `graphify update .` (AST-only). Restore the demo org to Both. Push `feat/ia-u4` and open the PR against `main` (after #63 has merged, rebase onto `main` first) with the QA table in the body.
