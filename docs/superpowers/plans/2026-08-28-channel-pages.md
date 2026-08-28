# Channel Pages Implementation Plan (slice 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every channel an org sells its own booking page — `/<handle>` (appointments, or spaces when there are no bookable services) and `/<handle>/spaces` — with its own draft/published document, its own builder tab, and an automatic cross-link between the two; existing single-channel orgs see nothing change except the "Spaces only" link becoming a path.

**Architecture:** `booking_pages` becomes one row per `(org_id, channel)` and the three definer RPCs gain `p_channel`. One pure routing rule (`resolveChannelPage` / `frontDoor` in `lib/booking/channel-pages.ts`) decides which page a public URL renders from what the gated catalogue actually holds; both public routes share one body (`renderChannelPage`). The builder loads exactly one page (`?page=`) and runs on a single-channel `OrgMode` (`pageChannelMode`), so `fitToMode`, the add-section palette, `pickersOnPage` and the thumbnails need no change. A `crossLink` on `RenderContext` is placed by a pure `crossLinkHost` rule (header → hero → booking).

**Tech Stack:** Next.js 16 App Router (server components, server actions, typed routes via `next typegen`), Supabase (PostgREST + `security definer` RPCs, RLS), Drizzle (`drizzle-kit generate` for shape, `generate --custom` for SQL), Vitest (`*.test.ts` pure, `*.integration.test.ts` against the local stack), Zod, Tailwind/shadcn (Base UI).

**Spec:** `docs/superpowers/specs/2026-08-28-channel-pages-and-starter-design.md` (commit `6a8552f` on `docs/channel-pages-starter-spec`). This plan implements §1–§4 and §8 item 1; slice 2 (the starter, §5) gets its own plan after this one is reviewed. Read the spec's **Rulings** first — every "why" below is there.

## Global Constraints

- **Branch `feat/channel-pages`, created from `docs/channel-pages-starter-spec`** (= `main` at `4a1d841` + the spec commit) so the PR carries the spec. Use the `superpowers:using-git-worktrees` skill at execution time; the worktree is expected at `.claude/worktrees/channel-pages`. Run everything from that directory.
- **Migrations `0059` (Drizzle) and `0060` (custom).** Before generating, confirm `ls src/db/migrations/*.sql | tail -1` prints `0058_prices_terms.sql`. If anything else has landed, stop and renumber the spec first. H4 moves to `0061`.
- **Local Supabase stack required** for `npm run db:migrate` and `npm run test:integration` (memory `rolloutos-local-supabase`: ports shifted +30; `DATABASE_URL` in `.env.local`). Never point drizzle-kit at a remote DB (`drizzle.config.ts` refuses unless `ALLOW_REMOTE_DB=1` — do not set it).
- **Document schema is untouched.** No `channel` on sections; `SINGLE_INSTANCE_TYPES` keeps `booking`; `save_booking_page_draft` keeps its "exactly one booking section" check.
- **Three channel words already exist; add exactly one more.** `OrgMode`'s `Channel = "appointments" | "rentals"` (what the org sells), `lib/booking/channel.ts`'s `Channel = "services" | "spaces"` (`?channel=`), and this plan's `PageChannel = "appointments" | "spaces"` (the stored page). Map between them only through `pageChannelMode` / `toCatalogChannel` (Task 1).
- **Vocabulary:** "Spaces" / "space" / "Appointments page" / "Spaces page" in anything a provider or client reads. Never "rental", "rentals", "offering" in copy (code identifiers `rental_*`, `offersRentals`, `/rentals` do not change). New copy goes in `src/features/orgs/vocab.ts`.
- **House test pattern:** pure `.test.ts` next to the module, vitest node env, **no component tests**. Anything that must be tested is a pure module; components stay thin.
- **Verify before claiming done:** `npm run verify` (lint + typecheck + unit). Use `npm run typecheck` (runs `next typegen` first — required after adding the `/[handle]/spaces` route), never bare `tsc`.
- **Bash guard (memory `landing-redesign-v3-notes`):** heredoc writes with template literals/spreads are silently rejected in worktrees — write TS/TSX/SQL with the Write/Edit tools and confirm with `git status`.
- **Byte-for-byte on untouched lines** — implementers must not "fix" typographic quotes (’ “ ”) or reflow comments they are not changing.
- Commit after every task with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` as the trailer.

---

## File map

| File | Responsibility after this plan |
|---|---|
| `src/features/booking-page/channel.ts` **(new)** | `PAGE_CHANNELS`, `PageChannel`, `pageChannelMode`, `toCatalogChannel`, `parsePageChannel` |
| `src/lib/booking/url.ts` | `channelPath`, `channelUrl`; `bookingLink` channel targets become paths (`embedSrc` unchanged) |
| `src/lib/booking/channel-pages.ts` **(new)** | `Has`, `frontDoor`, `resolveChannelPage` — the routing truth table |
| `src/db/schema/booking-pages.ts` | `channel` column, composite PK |
| `src/db/migrations/0059_*.sql` **(new, generated)** | add `channel` (default `'appointments'`), drop old PK, add `(org_id, channel)` PK |
| `src/db/migrations/0060_booking_pages_channel_rpcs.sql` **(new, custom)** | check constraint, backfill spaces-only orgs, RPCs with `p_channel` |
| `src/features/booking-page/queries.ts` | `getPublishedPage(orgId, channel)`, `getPageDraftState(orgId, channel)`, **new** `getPageStates(orgId)` |
| `src/features/booking-page/actions.ts` | `{ channel, doc }` inputs; orphan sweep reads every page of the org |
| `src/features/booking-page/studio/use-page-draft.ts` | `usePageDraft(initial, channel)` |
| `src/features/booking-page/rpc.integration.test.ts` | channel on every call; per-channel isolation; `getPageStates` |
| `src/features/orgs/vocab.ts` | `APPOINTMENTS.page`, `SPACES.page`, `APPOINTMENTS.crossLink`, `SPACES.crossLink` |
| `src/features/booking-page/render/cross-link.ts` **(new)** | `crossLinkHost(sections)` |
| `src/features/booking-page/render/cross-link.tsx` **(new)** | `CrossLink` (anchor in public, inert span in preview) |
| `src/features/booking-page/render/context.ts` | `crossLink` on `RenderContext` |
| `src/features/booking-page/render/page-renderer.tsx` | hands the link to its host section |
| `src/features/booking-page/render/sections/{header,hero,booking}.tsx` · `src/components/branded-header.tsx` | the three placements |
| `src/features/booking-page/metadata.ts` | `pageMetadata(doc, org, supabaseUrl, channel)` |
| `src/lib/booking/catalog.ts` | `listPublicCatalog` memoised per request (`cache`) |
| `src/features/booking-page/render/channel-page.tsx` **(new)** | `renderChannelPage` — the body both public routes share |
| `src/app/[handle]/page.tsx` | root: `resolveChannelPage("root")`, `?channel=spaces` redirect |
| `src/app/[handle]/spaces/page.tsx` **(new)** | the spaces page, canonical rule |
| `src/app/[handle]/[staffSlug]/page.tsx` | appointments document, no cross-link |
| `src/features/scheduling/staff-slug.ts` · `schema.ts` · `staff-actions.ts` | reserved slugs `spaces`, `appointments` |
| `src/features/booking-page/studio/page-switch.tsx` **(new)** | *Appointments page · Spaces page* links |
| `src/app/(dashboard)/booking-page/page.tsx` · `studio/booking-page-builder.tsx` | `?page=`, single-channel mode, per-channel URLs, preview cross-link |
| `src/app/(dashboard)/bookings/page.tsx` | checklist "Publish" tracks the front door |

---

### Task 1: `PageChannel` vocabulary and the URL builders

**Files:**
- Create: `src/features/booking-page/channel.ts`, `src/features/booking-page/channel.test.ts`
- Modify: `src/lib/booking/url.ts`, `src/lib/booking/url.test.ts`

**Interfaces:**
- Produces: `PAGE_CHANNELS`, `type PageChannel = "appointments" | "spaces"`, `pageChannelMode(ch): OrgMode`, `toCatalogChannel(ch): "services" | "spaces"`, `parsePageChannel(raw: unknown): PageChannel | null`; `channelPath(handle, ch): string`, `channelUrl(appUrl, handle, ch): string`. Every later task imports these.
- Note: the spec put `channelPath` in `channel-pages.ts`; it lives in `url.ts` instead because `bookingLink` needs it and `channel-pages.ts` imports `url.ts` (a cycle otherwise). Task 9 amends the spec.

- [ ] **Step 1: Write the failing tests**

`src/features/booking-page/channel.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PAGE_CHANNELS, pageChannelMode, parsePageChannel, toCatalogChannel } from "./channel";

describe("PageChannel (spec 2026-08-28 §1)", () => {
  it("is exactly appointments and spaces", () => {
    expect(PAGE_CHANNELS).toEqual(["appointments", "spaces"]);
  });
  it("pageChannelMode is the single-channel OrgMode", () => {
    expect(pageChannelMode("appointments")).toEqual({ offersAppointments: true, offersRentals: false });
    expect(pageChannelMode("spaces")).toEqual({ offersAppointments: false, offersRentals: true });
  });
  it("toCatalogChannel speaks applyChannel's words", () => {
    expect(toCatalogChannel("appointments")).toBe("services");
    expect(toCatalogChannel("spaces")).toBe("spaces");
  });
  it("parsePageChannel accepts the two words and nothing else", () => {
    expect(parsePageChannel("appointments")).toBe("appointments");
    expect(parsePageChannel("spaces")).toBe("spaces");
    expect(parsePageChannel("services")).toBeNull();
    expect(parsePageChannel("Spaces")).toBeNull();
    expect(parsePageChannel(["spaces"])).toBeNull();
    expect(parsePageChannel(undefined)).toBeNull();
  });
});
```

In `src/lib/booking/url.test.ts`, import `channelPath, channelUrl` alongside the existing names, change the `bookingLink` expectation for `{ channel: "services" }` and add:

```ts
  it("channelPath / channelUrl: appointments is the root, spaces is a segment", () => {
    expect(channelPath("anna", "appointments")).toBe("/anna");
    expect(channelPath("anna", "spaces")).toBe("/anna/spaces");
    expect(channelUrl("https://booklo.co/", "anna", "spaces")).toBe("https://booklo.co/anna/spaces");
  });
  it("bookingLink: a channel target is that channel's PAGE, not a query (spec 2026-08-28 §3.6)", () => {
    expect(bookingLink("https://booklo.co", "anna", { channel: "services" })).toBe("https://booklo.co/anna");
    expect(bookingLink("https://booklo.co", "anna", { channel: "spaces" })).toBe("https://booklo.co/anna/spaces");
  });
```

and delete the old line `expect(bookingLink("https://booklo.co", "anna", { channel: "services" })).toBe("https://booklo.co/anna?channel=services");`. The `embedSrc` expectations stay exactly as they are — the embed keeps `?channel=`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/features/booking-page/channel.test.ts src/lib/booking/url.test.ts`
Expected: FAIL — `./channel` cannot be resolved; `channelPath` is not exported.

- [ ] **Step 3: Create `src/features/booking-page/channel.ts`**

```ts
import type { OrgMode } from "@/features/orgs/mode";
import type { Channel as CatalogChannel } from "@/lib/booking/channel";

/* The stored page channel (spec 2026-08-28 §1): one booking_pages row per
   channel an org sells. Distinct on purpose from OrgMode's Channel
   ("appointments" | "rentals" — what the org sells) and lib/booking/channel's
   Channel ("services" | "spaces" — the ?channel= query the widget-only
   embed still takes); these two mappers are the only bridges. */
export const PAGE_CHANNELS = ["appointments", "spaces"] as const;
export type PageChannel = (typeof PAGE_CHANNELS)[number];

/** The single-channel OrgMode a page renders with — fitToMode, addableTypes
    and the preview catalogue all take it, so a page only ever shows its own
    channel. */
export function pageChannelMode(channel: PageChannel): OrgMode {
  return { offersAppointments: channel === "appointments", offersRentals: channel === "spaces" };
}

/** The word applyChannel understands, for forcing the public catalogue. */
export function toCatalogChannel(channel: PageChannel): CatalogChannel {
  return channel === "appointments" ? "services" : "spaces";
}

/** `?page=` on the builder: one of the two words, else null. */
export function parsePageChannel(raw: unknown): PageChannel | null {
  return raw === "appointments" || raw === "spaces" ? raw : null;
}
```

- [ ] **Step 4: Add the builders to `src/lib/booking/url.ts`**

Add the import at the top (type-only, next to the existing `Channel` import):

```ts
import type { PageChannel } from "@/features/booking-page/channel";
```

After `bookingUrl`, add:

```ts
// One page per channel (spec 2026-08-28 §3): the appointments page is the
// root, the spaces page a fixed segment below it — so a shared /spaces link
// keeps working when the org later adds a service and the root moves.
// "spaces" (and "appointments", kept free for symmetry) are reserved staff
// slugs for the same reason: the static segment wins over /[staffSlug].
export function channelPath(handle: string, channel: PageChannel): string {
  return channel === "spaces" ? `${bookingPath(handle)}/spaces` : bookingPath(handle);
}

export function channelUrl(appUrl: string, handle: string, channel: PageChannel): string {
  return `${appUrl.replace(/\/+$/, "")}${channelPath(handle, channel)}`;
}
```

Replace `bookingLink` with:

```ts
export function bookingLink(appUrl: string, handle: string, target?: LinkTarget): string {
  if (target && "staff" in target) return bookingUrl(appUrl, handle, target.staff);
  // A channel is a page of its own (spec 2026-08-28 §3.6); the embed below
  // keeps the query because the iframe is the widget, not a page.
  if (target && "channel" in target) return channelUrl(appUrl, handle, target.channel === "spaces" ? "spaces" : "appointments");
  return `${bookingUrl(appUrl, handle)}${targetQuery(target)}`;
}
```

Update the `LinkTarget` comment block's last sentence to read: `A channel target is that channel's page on the hosted side (channelUrl) and a ?channel= query on the embed.`

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/features/booking-page/channel.test.ts src/lib/booking/url.test.ts`
Expected: PASS (all).

- [ ] **Step 6: Commit**

```bash
git add src/features/booking-page/channel.ts src/features/booking-page/channel.test.ts src/lib/booking/url.ts src/lib/booking/url.test.ts
git commit -m "feat(booking-page): PageChannel vocabulary; a channel link is that channel's page

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: The routing rule (`lib/booking/channel-pages.ts`)

**Files:**
- Create: `src/lib/booking/channel-pages.ts`, `src/lib/booking/channel-pages.test.ts`

**Interfaces:**
- Consumes: `PageChannel` (Task 1).
- Produces: `type Has = { services: boolean; spaces: boolean }`, `frontDoor(has): PageChannel | null`, `type ChannelPage = { channel: PageChannel; canonical: "root" | "spaces" }`, `resolveChannelPage(route: "root" | "spaces", has): ChannelPage | null`. Tasks 4, 6 and 8 consume these.

- [ ] **Step 1: Write the failing test**

`src/lib/booking/channel-pages.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { frontDoor, resolveChannelPage } from "./channel-pages";

const BOTH = { services: true, spaces: true };
const APPTS = { services: true, spaces: false };
const SPACES = { services: false, spaces: true };
const NONE = { services: false, spaces: false };

describe("frontDoor (spec 2026-08-28 ruling 5)", () => {
  it("appointments whenever a bookable service exists, else spaces, else nothing", () => {
    expect(frontDoor(BOTH)).toBe("appointments");
    expect(frontDoor(APPTS)).toBe("appointments");
    expect(frontDoor(SPACES)).toBe("spaces");
    expect(frontDoor(NONE)).toBeNull();
  });
});

describe("resolveChannelPage (spec §3.1 truth table)", () => {
  it("root: the front door, canonical at the root; 404 with nothing bookable", () => {
    expect(resolveChannelPage("root", BOTH)).toEqual({ channel: "appointments", canonical: "root" });
    expect(resolveChannelPage("root", APPTS)).toEqual({ channel: "appointments", canonical: "root" });
    expect(resolveChannelPage("root", SPACES)).toEqual({ channel: "spaces", canonical: "root" });
    expect(resolveChannelPage("root", NONE)).toBeNull();
  });
  it("spaces: always the spaces page when spaces are bookable; canonical root only for a spaces-only org", () => {
    expect(resolveChannelPage("spaces", BOTH)).toEqual({ channel: "spaces", canonical: "spaces" });
    expect(resolveChannelPage("spaces", SPACES)).toEqual({ channel: "spaces", canonical: "root" });
    expect(resolveChannelPage("spaces", APPTS)).toBeNull();
    expect(resolveChannelPage("spaces", NONE)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/booking/channel-pages.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/lib/booking/channel-pages.ts`**

```ts
import type { PageChannel } from "@/features/booking-page/channel";

/* Which page a public URL renders (spec 2026-08-28 §3.1). Pure, decided on
   the GATED catalogue — mode ∩ rentals flag ∩ bookable (an active service;
   a space with an active, plan-visible unit) — the same facts that make the
   page 404 today when both are empty. The rule is asymmetric on purpose: the
   root moves (appointments win it the moment a service is bookable) but
   /spaces never does, so a shared spaces link cannot break. */
export type Has = { services: boolean; spaces: boolean };

export type ChannelPage = { channel: PageChannel; canonical: "root" | "spaces" };

/** The page /<handle> shows: appointments when a service is bookable, else
    spaces, else null (404). The welcome checklist's "Publish" chip tracks
    the same page. */
export function frontDoor(has: Has): PageChannel | null {
  if (has.services) return "appointments";
  if (has.spaces) return "spaces";
  return null;
}

export function resolveChannelPage(route: "root" | "spaces", has: Has): ChannelPage | null {
  if (route === "root") {
    const channel = frontDoor(has);
    return channel ? { channel, canonical: "root" } : null;
  }
  if (!has.spaces) return null;
  // A spaces-only org's spaces page IS the root; /spaces still renders it
  // (links never break) but points its canonical at the root.
  return { channel: "spaces", canonical: has.services ? "spaces" : "root" };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/booking/channel-pages.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/booking/channel-pages.ts src/lib/booking/channel-pages.test.ts
git commit -m "feat(booking-page): resolveChannelPage — which page a public URL renders

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Migrations 0059 + 0060 — one `booking_pages` row per channel

**Files:**
- Modify: `src/db/schema/booking-pages.ts`
- Create (generated): `src/db/migrations/0059_<drizzle-name>.sql` + journal/snapshot entries
- Create (custom): `src/db/migrations/0060_booking_pages_channel_rpcs.sql` + journal entry
- Modify: `src/features/booking-page/rpc.integration.test.ts`

**Interfaces:**
- Produces: RPCs `save_booking_page_draft(p_org_id uuid, p_channel text, p_doc jsonb)`, `publish_booking_page(p_org_id uuid, p_channel text)`, `discard_booking_page_draft(p_org_id uuid, p_channel text, p_fallback jsonb)`; table `booking_pages(org_id, channel, draft, published, published_at, updated_at)` with PK `(org_id, channel)`. Task 4 consumes the RPC signatures.

- [ ] **Step 1: Confirm the numbering**

Run: `ls src/db/migrations/*.sql | tail -1`
Expected: `src/db/migrations/0058_prices_terms.sql`. Anything else → stop, report, renumber.

- [ ] **Step 2: Update the Drizzle schema**

Replace `src/db/schema/booking-pages.ts` with:

```ts
import { pgTable, uuid, jsonb, text, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";

// One booking page per CHANNEL an org sells (spec 2026-08-28 §2; one per org
// before 0059). `channel` is 'appointments' | 'spaces' (CHECK in 0060). `draft`
// is what the studio edits, `published` what /[handle] and /[handle]/spaces
// render (null = never published → the default composition). Both are
// validated documents (features/booking-page/schema.ts); the renderer still
// safeParses them. Written ONLY via the save/publish/discard definer RPCs
// (0060) — members may select their own rows, nothing more. The column
// default is harmless (only the RPCs write, and they always name the
// channel); it exists so 0059 could add the column to filled tables.
export const bookingPages = pgTable(
  "booking_pages",
  {
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    channel: text("channel").notNull().default("appointments"),
    draft: jsonb("draft").notNull(),
    published: jsonb("published"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.channel] })],
);
```

- [ ] **Step 3: Generate 0059 and read it**

Run: `npm run db:generate`
Expected: a new `src/db/migrations/0059_<two-words>.sql` plus `meta/0059_snapshot.json` and a journal entry with `idx: 59`.

Open the SQL. It must contain, in a working order, these three statements (Drizzle's exact spelling may differ; the semantics may not):

```sql
ALTER TABLE "booking_pages" DROP CONSTRAINT "booking_pages_pkey";--> statement-breakpoint
ALTER TABLE "booking_pages" ADD COLUMN "channel" text DEFAULT 'appointments' NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_pages" ADD CONSTRAINT "booking_pages_org_id_channel_pk" PRIMARY KEY("org_id","channel");
```

If Drizzle emitted the ADD COLUMN *after* the ADD CONSTRAINT, reorder the statements by hand (keep the `--> statement-breakpoint` markers). If it emitted the column without `DEFAULT 'appointments'`, add it — the existing rows must fill. Nothing else should be in the file.

- [ ] **Step 4: Create the custom 0060**

Run: `npx drizzle-kit generate --custom --name=booking_pages_channel_rpcs`
Expected: `src/db/migrations/0060_booking_pages_channel_rpcs.sql` (empty) and a journal entry `idx: 60`.

Write this into it:

```sql
-- 0060 (channel pages, spec 2026-08-28 §2): one booking_pages row per
-- channel. 0059 added `channel` (default 'appointments') and the composite
-- key; this constrains the value, backfills spaces-only orgs (their one page
-- was their spaces page) and gives the three definer RPCs from 0048 a
-- channel. Idempotent.

alter table public.booking_pages drop constraint if exists booking_pages_channel_check;
alter table public.booking_pages add constraint booking_pages_channel_check
  check (channel in ('appointments', 'spaces'));

-- Backfill: an org that does not offer appointments (0054: at least one
-- channel is always on) had exactly one page and it listed spaces. Guarded
-- so a re-run cannot collide with a spaces row written since.
update public.booking_pages p
   set channel = 'spaces'
  from public.orgs o
 where o.id = p.org_id
   and p.channel = 'appointments'
   and not o.offers_appointments
   and not exists (select 1 from public.booking_pages q where q.org_id = p.org_id and q.channel = 'spaces');

-- ---------- The 0048 signatures go away: one path, never two.
drop function if exists public.save_booking_page_draft(uuid, jsonb);
drop function if exists public.publish_booking_page(uuid);
drop function if exists public.discard_booking_page_draft(uuid, jsonb);

-- ---------- Save draft. Cheap structural checks only (0048's, plus the
-- channel): size cap, version, exactly one booking section. Full shape
-- validation is zod in the server action; the renderer safeParses regardless.
create or replace function public.save_booking_page_draft(
  p_org_id uuid,
  p_channel text,
  p_doc jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_org_id is null or p_org_id not in (select public.user_orgs()) then
    raise exception 'not found';
  end if;
  if p_channel is null or p_channel not in ('appointments', 'spaces') then raise exception 'not found'; end if;
  if p_doc is null or jsonb_typeof(p_doc) <> 'object' then raise exception 'not found'; end if;
  if pg_column_size(p_doc) > 65536 then raise exception 'too large'; end if;
  if p_doc->>'version' is distinct from '1' then raise exception 'not found'; end if;
  if jsonb_typeof(p_doc->'sections') <> 'array' then raise exception 'not found'; end if;
  if (select count(*) from jsonb_array_elements(p_doc->'sections') s where s->>'type' = 'booking') <> 1 then
    raise exception 'not found';
  end if;

  insert into public.booking_pages (org_id, channel, draft, updated_at)
    values (p_org_id, p_channel, p_doc, now())
    on conflict (org_id, channel) do update set draft = excluded.draft, updated_at = now();
end;
$$;

revoke all on function public.save_booking_page_draft(uuid, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.save_booking_page_draft(uuid, text, jsonb) to authenticated;

-- ---------- Publish: that channel's draft becomes its live page. The action
-- always saves first, so a missing row here is a genuine error.
create or replace function public.publish_booking_page(
  p_org_id uuid,
  p_channel text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_org_id is null or p_org_id not in (select public.user_orgs()) then
    raise exception 'not found';
  end if;
  if p_channel is null or p_channel not in ('appointments', 'spaces') then raise exception 'not found'; end if;
  update public.booking_pages
    set published = draft, published_at = now(), updated_at = now()
    where org_id = p_org_id and channel = p_channel;
  if not found then raise exception 'not found'; end if;
end;
$$;

revoke all on function public.publish_booking_page(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.publish_booking_page(uuid, text) to authenticated;

-- ---------- Discard: that channel's draft goes back to its published page,
-- or to the caller-supplied default composition when never published. No
-- row = nothing to discard (not an error: the studio may never have autosaved).
create or replace function public.discard_booking_page_draft(
  p_org_id uuid,
  p_channel text,
  p_fallback jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_org_id is null or p_org_id not in (select public.user_orgs()) then
    raise exception 'not found';
  end if;
  if p_channel is null or p_channel not in ('appointments', 'spaces') then raise exception 'not found'; end if;
  if p_fallback is null or jsonb_typeof(p_fallback) <> 'object' then raise exception 'not found'; end if;
  update public.booking_pages
    set draft = coalesce(published, p_fallback), updated_at = now()
    where org_id = p_org_id and channel = p_channel;
end;
$$;

revoke all on function public.discard_booking_page_draft(uuid, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.discard_booking_page_draft(uuid, text, jsonb) to authenticated;

-- PostgREST caches the schema; the new signatures must be visible immediately.
notify pgrst, 'reload schema';
```

- [ ] **Step 5: Migrate the local stack and eyeball the backfill**

Run: `npm run db:migrate`
Expected: both migrations apply without error.

Run: `psql "$(grep '^DATABASE_URL=' .env.local | cut -d= -f2-)" -c "select o.handle, o.offers_appointments, o.offers_rentals, p.channel from booking_pages p join orgs o on o.id = p.org_id order by 1"`
Expected: every row with `offers_appointments = t` shows `appointments`; any row with `offers_appointments = f` shows `spaces`. (The seeded demo org is a both-org → `appointments`.)

- [ ] **Step 6: Update the integration tests**

In `src/features/booking-page/rpc.integration.test.ts`:

1. Add `p_channel: "appointments"` to **every** existing `owner.rpc(...)`, `stranger.rpc(...)` and `third.rpc(...)` call on the three page RPCs (12 calls). Every `admin.from("booking_pages").select(...).eq("org_id", …)` that ends in `.single()` also gets `.eq("channel", "appointments")` — after this task an org can have two rows.
2. In the `getPublishedPage` test, every call becomes `getPublishedPage(orgId, "appointments")` / `getPublishedPage(strangerOrgId, "appointments")`, and the `admin.from("booking_pages").update(...)` gets `.eq("channel", "appointments")`.
3. Add this block at the **end of the file** (after `describe("getPublishedPage", …)` — it leaves a second row behind, and the earlier tests assume one row per org):

```ts
describe("channels (spec 2026-08-28 §2)", () => {
  it("each channel is its own row; save/publish/discard on one never touch the other", async () => {
    const spacesDoc = { ...DEFAULT_PAGE, sections: [{ ...header, tagline: "Rooms" }, booking] };
    // appointments: publish withHero, then leave an unpublished edit
    expect((await owner.rpc("save_booking_page_draft", { p_org_id: orgId, p_channel: "appointments", p_doc: withHero })).error).toBeNull();
    expect((await owner.rpc("publish_booking_page", { p_org_id: orgId, p_channel: "appointments" })).error).toBeNull();
    expect((await owner.rpc("save_booking_page_draft", { p_org_id: orgId, p_channel: "appointments", p_doc: DEFAULT_PAGE })).error).toBeNull();
    // spaces: a second row for the same org
    expect((await owner.rpc("save_booking_page_draft", { p_org_id: orgId, p_channel: "spaces", p_doc: spacesDoc })).error).toBeNull();
    const rows = await admin.from("booking_pages").select("channel, draft, published").eq("org_id", orgId).order("channel");
    expect(rows.data!.map((r) => r.channel)).toEqual(["appointments", "spaces"]);
    expect(rows.data![1]!.published).toBeNull();
    // publishing spaces leaves the appointments draft edit in place
    expect((await owner.rpc("publish_booking_page", { p_org_id: orgId, p_channel: "spaces" })).error).toBeNull();
    const after = await admin.from("booking_pages").select("channel, draft, published").eq("org_id", orgId).order("channel");
    expect(after.data![0]!.draft).toEqual(DEFAULT_PAGE);
    expect(after.data![0]!.published).toEqual(withHero);
    expect(after.data![1]!.published).toEqual(spacesDoc);
    // discarding appointments restores withHero and leaves spaces alone
    expect((await owner.rpc("discard_booking_page_draft", { p_org_id: orgId, p_channel: "appointments", p_fallback: DEFAULT_PAGE })).error).toBeNull();
    const final = await admin.from("booking_pages").select("channel, draft").eq("org_id", orgId).order("channel");
    expect(final.data![0]!.draft).toEqual(withHero);
    expect(final.data![1]!.draft).toEqual(spacesDoc);
  });
  it("rejects a channel outside the two words on every RPC", async () => {
    for (const bad of ["rentals", "services", "", null]) {
      expect((await owner.rpc("save_booking_page_draft", { p_org_id: orgId, p_channel: bad, p_doc: DEFAULT_PAGE })).error, `save ${bad}`).not.toBeNull();
      expect((await owner.rpc("publish_booking_page", { p_org_id: orgId, p_channel: bad })).error, `publish ${bad}`).not.toBeNull();
      expect((await owner.rpc("discard_booking_page_draft", { p_org_id: orgId, p_channel: bad, p_fallback: DEFAULT_PAGE })).error, `discard ${bad}`).not.toBeNull();
    }
  });
  it("a stranger still cannot write either channel", async () => {
    expect((await stranger.rpc("save_booking_page_draft", { p_org_id: orgId, p_channel: "spaces", p_doc: DEFAULT_PAGE })).error).not.toBeNull();
    expect((await stranger.rpc("publish_booking_page", { p_org_id: orgId, p_channel: "spaces" })).error).not.toBeNull();
  });
});
```

- [ ] **Step 7: Run the integration tests**

Run: `npm run test:integration -- src/features/booking-page/rpc.integration.test.ts`
Expected: PASS. (`getPublishedPage` still takes one argument until Task 4 — the extra `"appointments"` is ignored, and with the channels block last the org has a single row while that test runs.)

- [ ] **Step 8: Commit**

```bash
git add src/db/schema/booking-pages.ts src/db/migrations src/features/booking-page/rpc.integration.test.ts
git commit -m "feat(db): booking_pages one row per channel — 0059 shape, 0060 backfill + RPCs with p_channel

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Queries, actions and the draft hook take a channel

**Files:**
- Modify: `src/features/booking-page/queries.ts`, `src/features/booking-page/actions.ts`, `src/features/booking-page/studio/use-page-draft.ts`, `src/features/booking-page/rpc.integration.test.ts`
- Modify (call sites, so typecheck stays green): `src/app/[handle]/page.tsx`, `src/app/[handle]/[staffSlug]/page.tsx`, `src/app/(dashboard)/booking-page/page.tsx`, `src/features/booking-page/studio/booking-page-builder.tsx`, `src/app/(dashboard)/bookings/page.tsx`

**Interfaces:**
- Consumes: RPC signatures (Task 3), `PageChannel`, `PAGE_CHANNELS` (Task 1), `frontDoor` (Task 2).
- Produces: `getPublishedPage(orgId, channel)`, `getPageDraftState(orgId, channel)`, `getPageStates(orgId): Promise<Partial<Record<PageChannel, PageDraftState>>>`; actions `saveBookingPageDraft({ channel, doc })`, `publishBookingPage({ channel, doc })`, `discardBookingPageDraft({ channel })`; `usePageDraft(initial, channel)`; `BookingPageBuilder` prop `channel: PageChannel`. Tasks 6 and 8 build on these.

- [ ] **Step 1: Rewrite `queries.ts`**

```ts
import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getDashboardFlags } from "@/lib/flags/resolve";
import { getEntitlements } from "@/lib/billing/queries";
import type { PlanLimits } from "@/lib/billing/plans";
import { DEFAULT_PAGE } from "./defaults";
import { parsePageDocument, type PageDocument } from "./schema";
import { parsePageChannel, type PageChannel } from "./channel";

/** One channel's published document for a public page, or DEFAULT_PAGE when
    there is none / it fails to parse (logged). Admin client: the public
    surface stays off the anon grant surface (getBookingOrg precedent).
    Memoised per request — the page and generateMetadata both read it. */
export const getPublishedPage = cache(async (orgId: string, channel: PageChannel): Promise<PageDocument> => {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("booking_pages")
    .select("published")
    .eq("org_id", orgId)
    .eq("channel", channel)
    .maybeSingle();
  if (error) {
    console.error("[booking-page] published read failed:", error.message);
    return DEFAULT_PAGE;
  }
  if (!data?.published) return DEFAULT_PAGE;
  const doc = parsePageDocument(data.published, orgId);
  if (!doc) {
    console.error(`[booking-page] published ${channel} document for org ${orgId} failed to parse — rendering the default page`);
    return DEFAULT_PAGE;
  }
  return doc;
});

export type PageDraftState = { draft: PageDocument; published: PageDocument | null; publishedAt: string | null };

type PageRow = { draft: unknown; published: unknown; published_at: string | null };

/** An unparseable stored draft falls back to the published page, then to
    the default — the same doctrine as getPublishedPage. */
function toDraftState(row: PageRow, orgId: string): PageDraftState {
  const published = row.published ? parsePageDocument(row.published, orgId) : null;
  return {
    draft: parsePageDocument(row.draft, orgId) ?? published ?? DEFAULT_PAGE,
    published,
    publishedAt: row.published_at,
  };
}

export const EMPTY_PAGE_STATE: PageDraftState = { draft: DEFAULT_PAGE, published: null, publishedAt: null };

/** RLS-scoped read of one channel's page for the studio. */
export async function getPageDraftState(orgId: string, channel: PageChannel): Promise<PageDraftState> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("booking_pages")
    .select("draft, published, published_at")
    .eq("org_id", orgId)
    .eq("channel", channel)
    .maybeSingle();
  if (error) throw error;
  return data ? toDraftState(data, orgId) : EMPTY_PAGE_STATE;
}

/** Every page of the org in one read, keyed by channel; a channel with no
    row is absent. The builder asks it "is anything published?" and the
    welcome checklist reads the front door's entry. */
export async function getPageStates(orgId: string): Promise<Partial<Record<PageChannel, PageDraftState>>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("booking_pages")
    .select("channel, draft, published, published_at")
    .eq("org_id", orgId);
  if (error) throw error;
  const out: Partial<Record<PageChannel, PageDraftState>> = {};
  for (const row of data ?? []) {
    const channel = parsePageChannel(row.channel);
    if (channel) out[channel] = toDraftState(row, orgId);
  }
  return out;
}

/** Fails OPEN: a billing hiccup must never block publishing a page. */
export async function getPageSectionsEntitlement(orgId: string): Promise<PlanLimits["pageSections"]> {
  try {
    if (!(await getDashboardFlags(orgId)).billing) return "all";
    return (await getEntitlements(orgId, await createClient())).pageSections;
  } catch (error) {
    console.error("[billing] page-sections read failed — publish proceeds:", error);
    return "all";
  }
}
```

- [ ] **Step 2: Rewrite the three write actions in `actions.ts`**

Add to the imports:

```ts
import { z } from "zod";
import { PAGE_CHANNELS, type PageChannel } from "./channel";
```

and change the queries import to `import { getPageStates, getPageSectionsEntitlement } from "./queries";` (`getPageDraftState` is no longer used here).

Replace everything from `async function saveDraft` down to the end of `discardBookingPageDraft` with:

```ts
// Every write names its page. `doc` stays `unknown` here: parsePageDocument
// owns the document's shape (and its org-scoped image-path check).
const pageWriteInput = z.object({ channel: z.enum(PAGE_CHANNELS), doc: z.unknown() });
const pageChannelInput = z.object({ channel: z.enum(PAGE_CHANNELS) });

async function saveDraft(orgId: string, channel: PageChannel, doc: PageDocument): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_booking_page_draft", { p_org_id: orgId, p_channel: channel, p_doc: doc });
  if (error) {
    if (isRpcSentinel(error, "too large")) return { ok: false, error: PAGE_TOO_LARGE_ERROR };
    return fail("saveDraft", error);
  }
  return { ok: true };
}

export async function saveBookingPageDraft(input: unknown): Promise<ActionState> {
  const parsed = pageWriteInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const doc = parsePageDocument(parsed.data.doc, orgId);
  if (!doc) return { ok: false, error: GENERIC_WRITE_ERROR };
  return saveDraft(orgId, parsed.data.channel, doc);
}

/** Saves, then publishes — never depends on a pending autosave or an existing row. */
export async function publishBookingPage(input: unknown): Promise<ActionState> {
  const parsed = pageWriteInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const doc = parsePageDocument(parsed.data.doc, orgId);
  if (!doc) return { ok: false, error: GENERIC_WRITE_ERROR };
  const pageSections = await getPageSectionsEntitlement(orgId);
  if (gatedVisibleSections(doc, { pageSections }).length > 0) return { ok: false, error: PAGE_GATED_ERROR };
  const saved = await saveDraft(orgId, parsed.data.channel, doc);
  if (!saved.ok) return saved;
  const supabase = await createClient();
  const { error } = await supabase.rpc("publish_booking_page", { p_org_id: orgId, p_channel: parsed.data.channel });
  if (error) return fail("publishBookingPage", error);
  await cleanupOrphans(orgId);
  revalidatePath("/booking-page");
  return { ok: true };
}

export async function discardBookingPageDraft(input: unknown): Promise<ActionState> {
  const parsed = pageChannelInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.rpc("discard_booking_page_draft", {
    p_org_id: orgId, p_channel: parsed.data.channel, p_fallback: DEFAULT_PAGE,
  });
  if (error) return fail("discardBookingPageDraft", error);
  await cleanupOrphans(orgId);
  revalidatePath("/booking-page");
  return { ok: true };
}
```

Replace `cleanupOrphans` (bottom of the file) with a version that reads **every** page of the org — with two pages, sweeping against one page's documents would delete images only the other page references:

```ts
/** Best-effort: delete objects under the org's page prefix that no page —
    any channel, draft or published — references. Reads the rows back after
    the write so the sweep sees exactly what the DB holds. Never throws,
    never fails the caller — the next publish/discard retries (evidence.ts
    orphan doctrine). */
async function cleanupOrphans(orgId: string): Promise<void> {
  try {
    const listed = await listPageObjects(orgId);
    if (listed === null) return;
    const states = Object.values(await getPageStates(orgId));
    const referenced = states.flatMap((s) => [...imagePathsIn(s.draft), ...(s.published ? imagePathsIn(s.published) : [])]);
    const orphans = orphanPaths(listed, referenced);
    if (orphans.length === 0) return;
    const { error: removeError } = await createAdminClient().storage.from(BRANDING_BUCKET).remove(orphans);
    if (removeError) console.error("[booking-page] orphan delete failed:", removeError.message);
  } catch (error) {
    console.error("[booking-page] orphan cleanup threw:", error);
  }
}
```

- [ ] **Step 3: Thread the channel through `use-page-draft.ts`**

Change the signature to:

```ts
export function usePageDraft(initial: { draft: PageDocument; published: PageDocument | null }, channel: PageChannel) {
```

with `import type { PageChannel } from "../channel";` added to the imports. Then, in the body:

- `saveDetached`: `void saveBookingPageDraft({ channel, doc: parsed.data })` and add `channel` to its dependency array: `}, [channel]);`
- `flush`: `const result = await saveBookingPageDraft({ channel, doc: valid });` and add `channel` to its deps: `}, [validate, clearTimer, startTransition, saveDetached, channel]);`
- `publish`: `const result = await publishBookingPage({ channel, doc: valid });` and deps `}, [validate, clearTimer, startTransition, settle, channel]);`
- `discard`: `const result = await discardBookingPageDraft({ channel });` and deps `}, [published, clearTimer, startTransition, settle, channel]);`

Add one line to the hook's header comment: `The page's channel rides every write; the hook never switches pages — the builder is re-mounted per ?page= (booking-page/page.tsx).`

- [ ] **Step 4: Update the call sites**

`src/features/booking-page/studio/booking-page-builder.tsx` — add `channel: PageChannel` to the props type and destructuring (import `type PageChannel` from `"../channel"`), and change `const draft = usePageDraft(initialPage);` to `const draft = usePageDraft(initialPage, channel);`.

`src/app/(dashboard)/booking-page/page.tsx` — interim wiring (Task 8 replaces this block with `?page=`): after `const declared = …`, add

```ts
  // Interim until Task 8: the page of the org's first declared channel.
  const channel: PageChannel = declared.offersAppointments ? "appointments" : "spaces";
```

(import `type PageChannel` from `"@/features/booking-page/channel"`), change `getPageDraftState(branding.orgId)` to `getPageDraftState(branding.orgId, channel)`, and pass `channel={channel}` to `<BookingPageBuilder>`.

`src/app/[handle]/page.tsx` — both `getPublishedPage(org.orgId)` calls become `getPublishedPage(org.orgId, org.offersAppointments ? "appointments" : "spaces")` (interim; Task 6 replaces both with the routing rule).

`src/app/[handle]/[staffSlug]/page.tsx` — both calls become `getPublishedPage(org.orgId, "appointments")` (final: a person's page is the appointments channel).

`src/app/(dashboard)/bookings/page.tsx` — the checklist reads the **front door's** page (spec §4.4). Change the import to `import { getPageStates } from "@/features/booking-page/queries";`, add `import { frontDoor } from "@/lib/booking/channel-pages";`, and replace the `if (!dismissed) { … }` block's first lines with:

```ts
  if (!dismissed) {
    const [ownersWithHours, pages] = await Promise.all([countHoursOwners(), getPageStates(org.id)]);
    // Bookable = has an active unit: the measure the public page uses
    // (listPublicOfferings), so the chip cannot tick while /[handle] 404s.
    const bookableSpaceCount = spaces.filter((o) => o.activeUnitCount > 0).length;
    // "Publish your page" tracks the page /<handle> resolves to (spec
    // 2026-08-28 §4.4); before anything is bookable, the declared-first channel.
    const door = frontDoor({ services: activeServices.length > 0, spaces: bookableSpaceCount > 0 })
      ?? (eff.offersAppointments ? "appointments" : "spaces");
    checklist = setupChecklist({
      mode: eff,
      serviceCount: activeServices.length,
      spaceCount: spaces.length,
      bookableSpaceCount,
      unitlessSpaceId: spaces.find((o) => o.activeUnitCount === 0)?.id ?? null,
      hourlySpaceCount: spaces.filter((o) => o.rangeMode === "hours").length,
      ownersWithHours,
      published: (pages[door]?.published ?? null) !== null,
    });
  }
```

- [ ] **Step 5: Extend the integration test for `getPageStates`**

In `rpc.integration.test.ts`, add inside `describe("getPublishedPage", …)` (rename the describe to `"getPublishedPage / getPageStates"`):

```ts
  it("getPageStates keys every row by channel and skips channels with no row", async () => {
    // queries.ts creates an RLS client from cookies; the RPC rows above are
    // enough to check the admin-side shape through getPublishedPage, and the
    // keyed read through a direct select with the owner client mirrors it.
    const { data } = await owner.from("booking_pages").select("channel").eq("org_id", strangerOrgId);
    expect(data ?? []).toHaveLength(0); // stranger's rows are invisible to owner
    const mine = await owner.from("booking_pages").select("channel").eq("org_id", orgId).order("channel");
    expect(mine.data!.map((r) => r.channel)).toEqual(["appointments", "spaces"]);
  });
```

(`getPageStates` itself needs a cookie-backed client, which the integration harness has no way to hand it — the shape it maps is exercised here through the same select; its channel-keying is trivially `parsePageChannel`, unit-tested in Task 1.)

- [ ] **Step 6: Typecheck, unit, integration**

Run: `npm run typecheck`
Expected: clean. If it lists a `RenderContext`/`getPublishedPage` call site this task missed, fix it the same way.

Run: `npm run test && npm run test:integration -- src/features/booking-page/rpc.integration.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/booking-page src/app "src/app/(dashboard)"
git commit -m "feat(booking-page): every read and write names its page — queries, actions, draft hook take a channel

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: The cross-link — placement rule, component, three hosts

**Files:**
- Create: `src/features/booking-page/render/cross-link.ts`, `src/features/booking-page/render/cross-link.test.ts`, `src/features/booking-page/render/cross-link.tsx`
- Modify: `src/features/orgs/vocab.ts`, `src/features/booking-page/render/context.ts`, `src/features/booking-page/render/page-renderer.tsx`, `src/features/booking-page/render/sections/header.tsx`, `src/features/booking-page/render/sections/hero.tsx`, `src/features/booking-page/render/sections/booking.tsx`, `src/components/branded-header.tsx`, plus the three `RenderContext` construction sites (`src/app/[handle]/page.tsx`, `src/app/[handle]/[staffSlug]/page.tsx`, `src/features/booking-page/studio/booking-page-builder.tsx`)

**Interfaces:**
- Produces: `RenderContext.crossLink: { href: string; label: string } | null` (required); `crossLinkHost(sections: Section[]): { sectionId: string; placement: "header" | "hero" | "booking" } | null`; `CrossLink` component; `SPACES.crossLink`, `APPOINTMENTS.crossLink`. Tasks 6 and 8 fill `crossLink` in.

- [ ] **Step 1: Write the failing test**

`src/features/booking-page/render/cross-link.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { crossLinkHost } from "./cross-link";
import { DEFAULT_PAGE, newSection } from "../defaults";
import type { Section } from "../schema";

const header = DEFAULT_PAGE.sections[0]!;
const booking = DEFAULT_PAGE.sections[1]!;
const hero = { ...newSection("hero", "hero0001"), headline: "Hi" } as Section;
const about = newSection("about", "about001");

describe("crossLinkHost (spec 2026-08-28 §3.5)", () => {
  it("the first section hosts it when it is a header or a hero", () => {
    expect(crossLinkHost([header, booking])).toEqual({ sectionId: header.id, placement: "header" });
    expect(crossLinkHost([hero, about, booking])).toEqual({ sectionId: "hero0001", placement: "hero" });
  });
  it("otherwise the booking section hosts it, above the widget", () => {
    expect(crossLinkHost([about, booking])).toEqual({ sectionId: booking.id, placement: "booking" });
    expect(crossLinkHost([about, header, booking])).toEqual({ sectionId: booking.id, placement: "booking" });
  });
  it("is total: no sections, no host", () => {
    expect(crossLinkHost([])).toBeNull();
    expect(crossLinkHost([about])).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/booking-page/render/cross-link.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `cross-link.ts`**

```ts
import type { Section } from "../schema";

export type CrossLinkPlacement = "header" | "hero" | "booking";
export type CrossLinkHost = { sectionId: string; placement: CrossLinkPlacement };

/* Where a page's link to its sibling channel page goes (spec 2026-08-28
   §3.5): the top of the page when the top is a header or a cover, else just
   above the widget. Decided on the PUBLIC-visible list (publicSections —
   hidden and empty sections gone) so preview, thumbnails and the live page
   agree, exactly as pickersOnPage does. */
export function crossLinkHost(sections: Section[]): CrossLinkHost | null {
  const first = sections[0];
  if (first && (first.type === "header" || first.type === "hero")) return { sectionId: first.id, placement: first.type };
  const booking = sections.find((s) => s.type === "booking");
  return booking ? { sectionId: booking.id, placement: "booking" } : null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/features/booking-page/render/cross-link.test.ts`
Expected: PASS.

- [ ] **Step 5: Copy, context, component**

`src/features/orgs/vocab.ts` — inside `SPACES`, after the `only:` entry, add:

```ts
  /** The appointments page's link to the spaces page (render/cross-link.tsx). */
  crossLink: "Looking for a room? Book a space →",
```

Inside `APPOINTMENTS`, after `only:`, add:

```ts
  /** The spaces page's link to the appointments page (render/cross-link.tsx). */
  crossLink: "Need an appointment? Book a time →",
```

`src/features/booking-page/render/context.ts` — add to `RenderContext`, after `mode`:

```ts
  /** The link to the org's other channel page, when one is bookable (spec
      2026-08-28 §3.5); placed by crossLinkHost. `href` is "#" in preview. */
  crossLink: { href: string; label: string } | null;
```

Create `src/features/booking-page/render/cross-link.tsx`:

```tsx
import { cn } from "@/lib/utils";
import type { RenderContext } from "./context";

/* The sibling-channel link. A plain anchor in public (works before
   hydration); inert in preview like every other link on the page — the
   SectionFrame around it takes the click to select. Theme tokens only, no
   accent fill: it is a way out, not the call to action. */
export function CrossLink({ link, mode, className }: { link: RenderContext["crossLink"]; mode: RenderContext["mode"]; className?: string }) {
  if (!link) return null;
  const cls = cn("text-muted-foreground hover:text-foreground text-sm underline-offset-3 hover:underline", className);
  return mode === "public" ? (
    <a href={link.href} className={cls}>{link.label}</a>
  ) : (
    <span aria-disabled className={cn(cls, "cursor-default")}>{link.label}</span>
  );
}
```

- [ ] **Step 6: The renderer hands the link to its host**

In `page-renderer.tsx`, add `import { crossLinkHost } from "./cross-link";` and change `renderSection` to take the link:

```tsx
function renderSection(section: Section, ctx: RenderContext, pickers: Pickers, crossLink: RenderContext["crossLink"]) {
  switch (section.type) {
    case "header": return <HeaderSection section={section} ctx={ctx} crossLink={crossLink} />;
    case "hero": return <HeroSection section={section} ctx={ctx} pickers={pickers} crossLink={crossLink} />;
    case "about": return <AboutSection section={section} ctx={ctx} />;
    case "services": return <ServicesSection section={section} ctx={ctx} />;
    case "staff": return <StaffSection section={section} ctx={ctx} />;
    case "spaces": return <SpacesSection section={section} ctx={ctx} />;
    case "gallery": return <GallerySection section={section} ctx={ctx} />;
    case "testimonials": return <TestimonialsSection section={section} ctx={ctx} />;
    case "faq": return <FaqSection section={section} ctx={ctx} />;
    case "links": return <LinksSection section={section} ctx={ctx} />;
    case "location": return <LocationSection section={section} ctx={ctx} />;
    case "booking": return <BookingSection section={section} ctx={ctx} pickers={pickers} crossLink={crossLink} />;
  }
}
```

In `PageRenderer`, after `const pickers = pickersOnPage(doc, counts);` add:

```tsx
  // The sibling-channel link's host, decided on the public-visible list so
  // preview and live agree (same doctrine as pickers). One section gets it.
  const host = ctx.crossLink ? crossLinkHost(publicSections(doc, counts)) : null;
```

and change the render call to `const inner = renderSection(section, ctx, pickers, host?.sectionId === section.id ? ctx.crossLink : null);`.

- [ ] **Step 7: The three placements**

`src/components/branded-header.tsx` — add an optional `aside?: React.ReactNode` prop (after `subtitle`) and render it at the right of the name row:

```tsx
      <div className="flex items-center gap-2">
        {logoUrl ? (
          // External Supabase public URL; next/image would need
          // remotePatterns configured for marginal gain on a tiny logo.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={`${orgName} logo`} className="h-6 w-auto max-w-32 object-contain" />
        ) : null}
        <span className="text-sm font-semibold">{orgName}</span>
        {aside ? <span className="ml-auto">{aside}</span> : null}
      </div>
```

Add one sentence to its header comment: `` `aside` is the booking page's link to its sibling channel page (render/cross-link.tsx); /p and /portal never pass it. ``

`sections/header.tsx`:

```tsx
import { BrandedHeader } from "@/components/branded-header";
import type { SectionOf } from "../../schema";
import type { RenderContext } from "../context";
import { CrossLink } from "../cross-link";

export function HeaderSection({ section, ctx, crossLink }: { section: SectionOf<"header">; ctx: RenderContext; crossLink: RenderContext["crossLink"] }) {
  // A staff page keeps today's "Booking with X" line; the tagline otherwise.
  const subtitle = ctx.lockedStaff ? `Booking with ${ctx.lockedStaff.name}` : section.tagline.trim() || undefined;
  return (
    <BrandedHeader
      orgName={ctx.org.orgName}
      accentColor={ctx.branding.accentColor}
      logoUrl={ctx.branding.logoUrl}
      subtitle={subtitle}
      aside={<CrossLink link={crossLink} mode={ctx.mode} className="text-xs" />}
    />
  );
}
```

`sections/hero.tsx` — add `crossLink: RenderContext["crossLink"]` to the props (destructure it), import `CrossLink` from `"../cross-link"`, and render it right after the `<BookButton …/>` line:

```tsx
      <BookButton label={section.cta} href={bookHref(pickers)} mode={ctx.mode} />
      <CrossLink link={crossLink} mode={ctx.mode} />
```

`sections/booking.tsx` — add `crossLink: RenderContext["crossLink"]` to the props, import `CrossLink`, and render it between the title and the `<WidgetTheme>`:

```tsx
      {section.title.trim() ? <h2 className="text-xl font-semibold tracking-tight">{section.title}</h2> : null}
      <CrossLink link={crossLink} mode={ctx.mode} />
```

- [ ] **Step 8: Fill the field at every construction site (interim values)**

`crossLink` is required, so typecheck names every `RenderContext` literal. Set:
- `src/app/[handle]/page.tsx`: `crossLink: null,` (Task 6 computes it),
- `src/app/[handle]/[staffSlug]/page.tsx`: `crossLink: null,` (final — a person's page is not a channel page),
- `src/features/booking-page/studio/booking-page-builder.tsx`: `crossLink: null,` (Task 8 computes it).

- [ ] **Step 9: Verify**

Run: `npm run verify`
Expected: clean (lint, typecheck, unit). The thumbnails in the template picker render the header with an empty `aside` — nothing visible changes yet.

- [ ] **Step 10: Commit**

```bash
git add src/features/booking-page/render src/features/orgs/vocab.ts src/components/branded-header.tsx src/app src/features/booking-page/studio/booking-page-builder.tsx
git commit -m "feat(booking-page): cross-link to the sibling channel page — host rule, component, three placements

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Public routes — `/[handle]`, `/[handle]/spaces`, metadata

**Files:**
- Modify: `src/features/booking-page/metadata.ts`, `src/features/booking-page/metadata.test.ts`, `src/lib/booking/catalog.ts`, `src/app/[handle]/page.tsx`, `src/app/[handle]/[staffSlug]/page.tsx`
- Create: `src/features/booking-page/render/channel-page.tsx`, `src/app/[handle]/spaces/page.tsx`

**Interfaces:**
- Consumes: `resolveChannelPage`, `frontDoor` (Task 2), `channelPath`, `channelUrl` (Task 1), `getPublishedPage(orgId, channel)` (Task 4), `RenderContext.crossLink` (Task 5), vocab `crossLink` copy.
- Produces: `pageMetadata(doc, org, supabaseUrl, channel)`, `renderChannelPage(args)`, `listPublicCatalog` memoised.

- [ ] **Step 1: Write the failing metadata test**

In `src/features/booking-page/metadata.test.ts`, every `pageMetadata(...)` call gains a fourth argument `"appointments"`. Then add to `describe("pageMetadata")`:

```ts
  it("the fallback description is the PAGE's channel, not the org's declared mix (spec 2026-08-28 §3.6)", () => {
    const BOTH = { orgName: "Anna's", offersAppointments: true, offersRentals: true };
    expect(pageMetadata(DEFAULT_PAGE, BOTH, "http://127.0.0.1:54351", "appointments").description).toBe("Book an appointment with Anna's.");
    expect(pageMetadata(DEFAULT_PAGE, BOTH, "http://127.0.0.1:54351", "spaces").description).toBe("Book a space at Anna's.");
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/features/booking-page/metadata.test.ts`
Expected: FAIL — the fourth argument is ignored and both descriptions read "Book with Anna's."

- [ ] **Step 3: `pageMetadata` takes the channel**

Replace the imports and `pageMetadata` in `metadata.ts`:

```ts
import type { Metadata } from "next";
import type { PageDocument } from "./schema";
import { pageImageUrl } from "./images";
import { bookingDescription } from "@/features/orgs/vocab";
import { pageChannelMode, type PageChannel } from "./channel";
```

```ts
export function pageMetadata(
  doc: PageDocument,
  org: { orgName: string },
  supabaseUrl: string,
  channel: PageChannel,
): Metadata {
  const image = heroImagePath(doc);
  // The page's own channel (spec 2026-08-28 §3.6): a spaces page says
  // "Book a space at X" whatever else the org sells.
  return {
    title: org.orgName,
    description: pageDescription(doc, bookingDescription(pageChannelMode(channel), org.orgName)),
    ...(image ? { openGraph: { images: [pageImageUrl(supabaseUrl, image)] } } : {}),
  };
}
```

(`modeOf` / `OrgMode` imports go; the old comment about declared vs effective mode goes with them.)

Run: `npx vitest run src/features/booking-page/metadata.test.ts` → PASS.

- [ ] **Step 4: Memoise `listPublicCatalog`**

`generateMetadata` and the page both need the catalogue now (the channel decides which document to read). In `src/lib/booking/catalog.ts` wrap the function with React's `cache` — `getBookingOrg` is itself memoised, so both callers pass the same `org` object and hit the same entry:

```ts
import { cache } from "react";
```

```ts
export const listPublicCatalog = cache(async (org: BookingOrg): Promise<{
  offering: Awaited<ReturnType<typeof loadPublicOffering>>;
  offerings: PublicOffering[];
}> => {
  … body unchanged …
});
```

Add to its header comment: `Memoised per request: generateMetadata and the page both resolve the channel from it.`

Below it, add the one helper both routes (and their `generateMetadata`) use to turn the catalogue into the routing rule's input — in `catalog.ts`, not duplicated per route:

```ts
/** What the gated catalogue holds, as the routing rule reads it (spec 2026-08-28 §3.1). */
export function catalogueHas(cat: Awaited<ReturnType<typeof listPublicCatalog>>): Has {
  return { services: cat.offering.services.length > 0, spaces: cat.offerings.length > 0 };
}
```

with `import type { Has } from "./channel-pages";`. In the two route files below, replace every `hasOf(org)` with `catalogueHas(await listPublicCatalog(org))`, drop the local `hasOf` helper, and build `has` in the page bodies as `const has = catalogueHas(catalogue);` (importing `catalogueHas` next to `listPublicCatalog`).

- [ ] **Step 5: The shared body — `render/channel-page.tsx`**

```tsx
import { getOrgBranding } from "@/lib/org-branding";
import { badgeVisible } from "@/lib/billing/entitlements";
import { PoweredBy } from "@/components/powered-by";
import { WidgetTheme } from "@/components/widget-theme";
import { parseWidgetTheme } from "@/lib/widget-theme";
import { bookShellClass } from "@/lib/book-shell";
import { cn } from "@/lib/utils";
import { env } from "@/env";
import type { BookingOrg } from "@/lib/booking/public";
import type { listPublicCatalog } from "@/lib/booking/catalog";
import { applyChannel } from "@/lib/booking/channel";
import { bookingPath, channelPath } from "@/lib/booking/url";
import type { ChannelPage } from "@/lib/booking/channel-pages";
import { APPOINTMENTS, SPACES } from "@/features/orgs/vocab";
import { getPublishedPage } from "../queries";
import { toCatalogChannel } from "../channel";
import { resolveInitialOffering, resolveInitialService } from "../initial-service";
import type { RenderContext } from "./context";
import { PageRenderer, pageContainerClass } from "./page-renderer";

type Catalogue = Awaited<ReturnType<typeof listPublicCatalog>>;

/* One channel page (spec 2026-08-28 §3): /[handle] and /[handle]/spaces
   both come through here so they cannot drift. The route has already
   resolved WHICH page (resolveChannelPage) and handled its 404/redirect;
   this forces the catalogue to that channel, reads that channel's
   published document and renders the same shell the page always had. */
export async function renderChannelPage({
  org, handle, page, catalogue, searchParams,
}: {
  org: BookingOrg; handle: string; page: ChannelPage; catalogue: Catalogue;
  searchParams: { service?: string | string[]; space?: string | string[] };
}) {
  const { offering, offerings } = catalogue;
  const [branding, doc] = await Promise.all([getOrgBranding(org.orgId), getPublishedPage(org.orgId, page.channel)]);
  const theme = parseWidgetTheme(branding.themeRaw);
  // The page's channel is forced — no longer a query — before the widget,
  // its headings and the builder's Services / Spaces / Staff sections read
  // it, so they all agree (publicSections drops the emptied sections).
  const cat = applyChannel(
    { services: offering.services, staff: offering.staff, serviceStaffIds: offering.serviceStaffIds, offerings },
    toCatalogChannel(page.channel),
  );
  // The other channel's page, when it has something to book (§3.5).
  const crossLink: RenderContext["crossLink"] =
    page.channel === "appointments" && offerings.length > 0
      ? { href: channelPath(handle, "spaces"), label: SPACES.crossLink }
      : page.channel === "spaces" && offering.services.length > 0
        ? { href: bookingPath(handle), label: APPOINTMENTS.crossLink }
        : null;
  const ctx: RenderContext = {
    org: { orgId: org.orgId, orgName: org.orgName, handle, timeZone: org.timeZone, currency: org.currency },
    branding: { accentColor: branding.accentColor, logoUrl: branding.logoUrl },
    theme, services: cat.services, staff: cat.staff, serviceStaffIds: cat.serviceStaffIds, offerings: cat.offerings, lockedStaff: null,
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL, mode: "public", crossLink,
  };
  return (
    // The whole page takes the org's widget theme (light / dark / auto), so
    // the transparent widget always sits on a matching surface — the same
    // guarantee the embed can't give on a third-party site.
    <div className={bookShellClass(theme.theme)}>
      {/* Theme tokens (font, radius, accent, text, lines) for every section;
          always transparent — the shell paints the ground. The booking
          section nests its own WidgetTheme for the widget's surface. */}
      <WidgetTheme config={theme} accentColor={branding.accentColor} transparent className="flex flex-1 flex-col">
        <main className={cn("mx-auto flex w-full flex-col gap-6 p-6", pageContainerClass(doc.layout))}>
          <PageRenderer
            doc={doc}
            ctx={ctx}
            initialServiceId={resolveInitialService(cat.services, searchParams.service)}
            initialOfferingId={resolveInitialOffering(cat.offerings, searchParams.space)}
          />
          {/* Same rule as the embed: the badge shows unless the org both asked
              to hide it and is on a plan that may (spec §5). */}
          {badgeVisible(theme.hidePoweredBy, offering.entitlements) ? <PoweredBy handle={handle} /> : null}
        </main>
      </WidgetTheme>
    </div>
  );
}
```

- [ ] **Step 6: Rewrite `src/app/[handle]/page.tsx`**

```tsx
import type { Metadata } from "next";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { getBookingOrg, resolveHandleAlias } from "@/lib/booking/public";
import { bookingPath, channelPath } from "@/lib/booking/url";
import { listPublicCatalog } from "@/lib/booking/catalog";
import { resolveChannelPage, type Has } from "@/lib/booking/channel-pages";
import { resolveChannelParam } from "@/lib/booking/channel";
import { env } from "@/env";
import { getPublishedPage } from "@/features/booking-page/queries";
import { pageMetadata } from "@/features/booking-page/metadata";
import { renderChannelPage } from "@/features/booking-page/render/channel-page";
import { HANDLE_RE } from "@/features/scheduling/handle";

// The root page: appointments when a service is bookable, else spaces
// (spec 2026-08-28 §3.1). listPublicCatalog is memoised per request, so
// generateMetadata and the page resolve the same channel from one read.
async function hasOf(org: NonNullable<Awaited<ReturnType<typeof getBookingOrg>>>): Promise<Has> {
  const { offering, offerings } = await listPublicCatalog(org);
  return { services: offering.services.length > 0, spaces: offerings.length > 0 };
}

export async function generateMetadata({ params }: PageProps<"/[handle]">): Promise<Metadata> {
  const { handle } = await params;
  if (!HANDLE_RE.test(handle)) return {};
  const org = await getBookingOrg(handle);
  if (!org) return {};
  const page = resolveChannelPage("root", await hasOf(org));
  if (!page) return {};
  return pageMetadata(await getPublishedPage(org.orgId, page.channel), org, env.NEXT_PUBLIC_SUPABASE_URL, page.channel);
}

export default async function BookPage({ params, searchParams }: PageProps<"/[handle]">) {
  const { handle } = await params;
  // Typed with capitals (a business card, a spoken URL) → the canonical
  // lowercase address; anything else off-shape is a 404.
  if (handle !== handle.toLowerCase() && HANDLE_RE.test(handle.toLowerCase())) {
    permanentRedirect(bookingPath(handle.toLowerCase()));
  }
  if (!HANDLE_RE.test(handle)) notFound();
  const org = await getBookingOrg(handle);
  if (!org) {
    // A handle the org renamed away from (0052 org_handle_history) keeps
    // working: old emails and printed links follow the org.
    const current = await resolveHandleAlias(handle);
    if (current) permanentRedirect(bookingPath(current));
    notFound();
  }
  // The gated catalogue: services/staff and offerings, each present only
  // while its channel (org mode, and for rentals the feature flag too) is on.
  const catalogue = await listPublicCatalog(org);
  const has: Has = { services: catalogue.offering.services.length > 0, spaces: catalogue.offerings.length > 0 };
  const page = resolveChannelPage("root", has);
  if (!page) notFound();
  const sp = await searchParams;
  // `?channel=spaces` predates the spaces page (admin IA spec §5): it now
  // means that page. Temporary — it depends on data. `?channel=services`
  // is the root already (or degrades exactly as applyChannel did).
  if (resolveChannelParam(sp.channel) === "spaces" && page.channel === "appointments" && has.spaces) {
    redirect(channelPath(handle, "spaces"));
  }
  return renderChannelPage({ org, handle, page, catalogue, searchParams: sp });
}
```

- [ ] **Step 7: Create `src/app/[handle]/spaces/page.tsx`**

```tsx
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { getBookingOrg, resolveHandleAlias } from "@/lib/booking/public";
import { channelPath, channelUrl } from "@/lib/booking/url";
import { listPublicCatalog } from "@/lib/booking/catalog";
import { resolveChannelPage, type Has } from "@/lib/booking/channel-pages";
import { env } from "@/env";
import { getPublishedPage } from "@/features/booking-page/queries";
import { pageMetadata } from "@/features/booking-page/metadata";
import { renderChannelPage } from "@/features/booking-page/render/channel-page";
import { HANDLE_RE } from "@/features/scheduling/handle";

// The spaces page (spec 2026-08-28 §3.3): always the spaces channel while a
// space is bookable, so a shared link never breaks when the org later adds
// a service and the root moves. Next matches this static segment before
// /[handle]/[staffSlug] — hence "spaces" is a reserved staff slug.
async function hasOf(org: NonNullable<Awaited<ReturnType<typeof getBookingOrg>>>): Promise<Has> {
  const { offering, offerings } = await listPublicCatalog(org);
  return { services: offering.services.length > 0, spaces: offerings.length > 0 };
}

export async function generateMetadata({ params }: PageProps<"/[handle]/spaces">): Promise<Metadata> {
  const { handle } = await params;
  if (!HANDLE_RE.test(handle)) return {};
  const org = await getBookingOrg(handle);
  if (!org) return {};
  const page = resolveChannelPage("spaces", await hasOf(org));
  if (!page) return {};
  return {
    ...pageMetadata(await getPublishedPage(org.orgId, page.channel), org, env.NEXT_PUBLIC_SUPABASE_URL, page.channel),
    // A spaces-only org's spaces page IS the root: say so to crawlers.
    alternates: { canonical: channelUrl(env.NEXT_PUBLIC_APP_URL, handle, page.canonical === "root" ? "appointments" : "spaces") },
  };
}

export default async function SpacesPage({ params, searchParams }: PageProps<"/[handle]/spaces">) {
  const { handle } = await params;
  if (handle !== handle.toLowerCase() && HANDLE_RE.test(handle.toLowerCase())) {
    permanentRedirect(channelPath(handle.toLowerCase(), "spaces"));
  }
  if (!HANDLE_RE.test(handle)) notFound();
  const org = await getBookingOrg(handle);
  if (!org) {
    const current = await resolveHandleAlias(handle);
    if (current) permanentRedirect(channelPath(current, "spaces"));
    notFound();
  }
  const catalogue = await listPublicCatalog(org);
  const has: Has = { services: catalogue.offering.services.length > 0, spaces: catalogue.offerings.length > 0 };
  const page = resolveChannelPage("spaces", has);
  if (!page) notFound();
  return renderChannelPage({ org, handle, page, catalogue, searchParams: await searchParams });
}
```

Note `channelUrl(…, "appointments")` is the root URL — `channelPath("x", "appointments")` is `/x` (Task 1). `PageProps<"/[handle]/spaces">` exists only after `next typegen` runs (`npm run typecheck` does).

- [ ] **Step 8: Staff page metadata**

In `src/app/[handle]/[staffSlug]/page.tsx` the `generateMetadata` call becomes `pageMetadata(await getPublishedPage(org.orgId, "appointments"), org, env.NEXT_PUBLIC_SUPABASE_URL, "appointments")`. Nothing else changes (its `crossLink: null` landed in Task 5).

- [ ] **Step 9: Verify, then walk the routes**

Run: `npm run verify`
Expected: clean. Unused-import lint on `src/app/[handle]/page.tsx` (`applyChannel`, `getOrgBranding`, `WidgetTheme`, …) means Step 6 was applied partially — the file must be exactly the version above.

Start the dev server from the worktree (`npm run dev`, note its port) and, with the seeded demo org (`demo`, both channels, Studio template published):
- `http://localhost:<port>/demo` → the appointments page, header row shows "Looking for a room? Book a space →" on the right.
- `http://localhost:<port>/demo/spaces` → the default composition listing the spaces in the widget, header shows "Need an appointment? Book a time →".
- `http://localhost:<port>/demo?channel=spaces` → 307 to `/demo/spaces`.
- `http://localhost:<port>/demo/<a real staff slug>` → unchanged person page, no cross-link.

Use `localhost`, never `127.0.0.1` (memory `browser-qa-localhost-lesson`).

- [ ] **Step 10: Commit**

```bash
git add src/features/booking-page src/lib/booking/catalog.ts src/app
git commit -m "feat(booking-page): one public page per channel — /<handle> resolves the front door, /<handle>/spaces is always the spaces page

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Reserved staff slugs

**Files:**
- Modify: `src/features/scheduling/staff-slug.ts`, `src/features/scheduling/staff-slug.test.ts`, `src/features/scheduling/schema.ts`, `src/features/scheduling/schema.test.ts`, `src/features/scheduling/staff-actions.ts`

**Interfaces:**
- Produces: `RESERVED_STAFF_SLUGS`, `isReservedStaffSlug(slug)`, `STAFF_SLUG_RESERVED_ISSUE` (the zod message the actions map to `STAFF_SLUG_TAKEN_ERROR`).

- [ ] **Step 1: Write the failing tests**

Append to `describe("slugifyStaffName")` in `staff-slug.test.ts`:

```ts
  it("sidesteps the channel-page segments (spec 2026-08-28 §3.3)", () => {
    expect(slugifyStaffName("Spaces")).toBe("spaces-1");
    expect(slugifyStaffName("Appointments")).toBe("appointments-1");
    expect(slugifyStaffName("Spaces Team")).toBe("spaces-team");
  });
```

and a new describe:

```ts
describe("isReservedStaffSlug", () => {
  it("only the two page segments", () => {
    expect(isReservedStaffSlug("spaces")).toBe(true);
    expect(isReservedStaffSlug("appointments")).toBe(true);
    expect(isReservedStaffSlug("spaces-1")).toBe(false);
    expect(isReservedStaffSlug("anna")).toBe(false);
  });
});
```

(import `isReservedStaffSlug` from `./staff-slug`.)

In `src/features/scheduling/schema.test.ts`, find the existing `staffInput` cases (search `staffInput`) and add next to them:

```ts
  it("staffInput refuses a reserved slug with the reserved issue (spec 2026-08-28 §3.3)", () => {
    const base = { name: "X", slug: "spaces", color: "#4f46e5", serviceIds: [] };
    const result = staffInput.safeParse(base);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((i) => i.path[0] === "slug" && i.message === STAFF_SLUG_RESERVED_ISSUE)).toBe(true);
    expect(staffInput.safeParse({ ...base, slug: "spaces-1" }).success).toBe(true);
  });
```

(import `STAFF_SLUG_RESERVED_ISSUE` from `./schema`; if the file has no `staffInput` describe yet, add `describe("staffInput", …)` around this case.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/features/scheduling/staff-slug.test.ts src/features/scheduling/schema.test.ts`
Expected: FAIL — `isReservedStaffSlug` / `STAFF_SLUG_RESERVED_ISSUE` not exported; `slugifyStaffName("Spaces")` is `"spaces"`.

- [ ] **Step 3: Implement**

`staff-slug.ts` — after `STAFF_SLUG_RE`, add:

```ts
// The channel pages live at /<handle>/spaces (and /appointments is kept
// free for symmetry): Next matches those static segments before
// /[handle]/[staffSlug], so a person slugged the same would be unreachable.
export const RESERVED_STAFF_SLUGS = ["spaces", "appointments"] as const;
const RESERVED = new Set<string>(RESERVED_STAFF_SLUGS);
export function isReservedStaffSlug(slug: string): boolean {
  return RESERVED.has(slug);
}
```

In `slugifyStaffName`, before `if (s.length < 2)`, add:

```ts
  if (isReservedStaffSlug(s)) return `${s}-1`;
```

`schema.ts` — import `isReservedStaffSlug` next to `STAFF_SLUG_RE`, add

```ts
export const STAFF_SLUG_RESERVED_ISSUE = "reserved";
```

above `staffInput`, and change its slug field to:

```ts
  slug: z.string().regex(STAFF_SLUG_RE).refine((s) => !isReservedStaffSlug(s), { message: STAFF_SLUG_RESERVED_ISSUE }),
```

(`updateStaffInput` extends `staffInput`, so it inherits the rule.)

`staff-actions.ts` — in both `createStaff` and `updateStaff`, replace `if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };` with:

```ts
  if (!parsed.success) {
    // A reserved link name reads as "taken" to the owner — it is, by the page.
    const reserved = parsed.error.issues.some((i) => i.path[0] === "slug" && i.message === STAFF_SLUG_RESERVED_ISSUE);
    return { ok: false, error: reserved ? STAFF_SLUG_TAKEN_ERROR : GENERIC_WRITE_ERROR };
  }
```

(import `STAFF_SLUG_RESERVED_ISSUE` from `./schema` where `STAFF_SLUG_TAKEN_ERROR` is already imported.)

- [ ] **Step 4: Run the tests; check the DB**

Run: `npx vitest run src/features/scheduling/staff-slug.test.ts src/features/scheduling/schema.test.ts`
Expected: PASS.

Run: `psql "$(grep '^DATABASE_URL=' .env.local | cut -d= -f2-)" -c "select org_id, slug from staff where slug in ('spaces','appointments')"`
Expected: `(0 rows)`. If a row exists locally, rename it by hand (`update staff set slug = slug || '-1' where …`) and note it in the PR; no migration is written for this.

- [ ] **Step 5: Commit**

```bash
git add src/features/scheduling
git commit -m "feat(team): spaces and appointments are reserved link names — the channel pages own those segments

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Builder — `?page=`, single-channel mode, page switch, per-channel URLs, preview cross-link

**Files:**
- Create: `src/features/booking-page/studio/page-switch.tsx`
- Modify: `src/features/orgs/vocab.ts`, `src/app/(dashboard)/booking-page/page.tsx`, `src/features/booking-page/studio/booking-page-builder.tsx`

**Interfaces:**
- Consumes: `parsePageChannel`, `pageChannelMode`, `channelPath`, `channelUrl` (Task 1), `frontDoor` (Task 2), `getPageStates` (Task 4), `RenderContext.crossLink` (Task 5), vocab.
- Produces: `BookingPageBuilder` props `channel`, `switchable`, `crossLink`; `PageSwitch`; `APPOINTMENTS.page`, `SPACES.page`. Slice 2 adds `fresh` / `anyPublished` next to these.

- [ ] **Step 1: Copy**

`vocab.ts` — inside `SPACES`, after `crossLink:`, add:

```ts
  /** The builder's page switch (studio/page-switch.tsx) for a both-channel org. */
  page: "Spaces page",
```

Inside `APPOINTMENTS`, after `crossLink:`, add:

```ts
  /** The builder's page switch for a both-channel org. */
  page: "Appointments page",
```

- [ ] **Step 2: The switch**

Create `src/features/booking-page/studio/page-switch.tsx`:

```tsx
import Link from "next/link";
import { APPOINTMENTS, SPACES } from "@/features/orgs/vocab";
import type { PageChannel } from "../channel";
import { cn } from "@/lib/utils";

const PAGES: ReadonlyArray<{ channel: PageChannel; label: string }> = [
  { channel: "appointments", label: APPOINTMENTS.page },
  { channel: "spaces", label: SPACES.page },
];

/* Which of the org's two pages the studio is editing (spec 2026-08-28
   §4.2). Links, not tabs: the server loads the other page's draft and the
   builder re-mounts, so usePageDraft never has to switch documents.
   Rendered only for an org that declares both channels. */
export function PageSwitch({ value }: { value: PageChannel }) {
  return (
    <nav aria-label="Which page" className="border-border bg-muted/40 flex w-fit items-center gap-0.5 rounded-lg border p-0.5">
      {PAGES.map((p) => (
        <Link
          key={p.channel}
          href={`/booking-page?page=${p.channel}`}
          aria-current={value === p.channel ? "page" : undefined}
          className={cn(
            "focus-visible:ring-ring/50 flex h-7 items-center rounded-[6px] px-3 text-sm outline-none focus-visible:ring-2",
            value === p.channel ? "bg-background text-foreground font-medium shadow-xs" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {p.label}
        </Link>
      ))}
    </nav>
  );
}
```

- [ ] **Step 3: The route loads one page**

Replace `src/app/(dashboard)/booking-page/page.tsx` with:

```tsx
import { notFound } from "next/navigation";
import { getBrandingSettings, getSchedulingSettings } from "@/features/orgs/queries";
import { listServices } from "@/features/scheduling/queries";
import { listStaff } from "@/features/scheduling/staff-queries";
import { listOfferings } from "@/features/rentals/queries";
import { effectiveMode, modeOf, presentMode } from "@/features/orgs/mode";
import { APPOINTMENTS, SPACES } from "@/features/orgs/vocab";
import { isBookableOffering, toPreviewCatalog } from "@/lib/booking/preview-catalog";
import { frontDoor } from "@/lib/booking/channel-pages";
import { requireOrg } from "@/lib/auth/session";
import { getDashboardFlags } from "@/lib/flags/resolve";
import { pageChannelMode, parsePageChannel, type PageChannel } from "@/features/booking-page/channel";
import { EMPTY_PAGE_STATE, getPageStates, getPageSectionsEntitlement } from "@/features/booking-page/queries";
import { BookingPageBuilder } from "@/features/booking-page/studio/booking-page-builder";
import { PageSwitch } from "@/features/booking-page/studio/page-switch";
import { PageIntro } from "@/components/shell/page-header";
import { env } from "@/env";

/* Booking page: the hosted channel — its sections, address, timezone and
   branding, edited against a live preview of the page itself and published
   explicitly. (Branding's accent and theme are shared with the website embed.)
   One page per channel (spec 2026-08-28 §4): `?page=` names it. */
export default async function BookingPagePage({ searchParams }: PageProps<"/booking-page">) {
  const { org } = await requireOrg();
  const declared = effectiveMode(await getDashboardFlags(org.id), modeOf(org));
  const [branding, scheduling, services, staff, offerings] = await Promise.all([
    getBrandingSettings(),
    getSchedulingSettings(),
    listServices(),
    listStaff(),
    declared.offersRentals ? listOfferings() : [],
  ]);
  if (!branding || !scheduling) notFound();
  const has = { services: services.some((s) => s.active), spaces: offerings.some(isBookableOffering) };

  // Which page: ?page= when it names a channel the org declares; else the
  // front door (what /<handle> shows); else the declared-first channel.
  const requested = parsePageChannel((await searchParams).page);
  const offered = (c: PageChannel) => (c === "appointments" ? declared.offersAppointments : declared.offersRentals);
  const channel: PageChannel =
    requested && offered(requested) ? requested
    : (frontDoor(has) ?? (declared.offersAppointments ? "appointments" : "spaces"));
  // A page IS its channel: the renderer, fitToMode, the add-section palette
  // and the thumbnails all take this single-channel mode. The canned
  // stand-in (preview-catalog) appears only for THIS channel when it has
  // nothing bookable yet — never "Studio A" on an appointments page.
  const mode = pageChannelMode(channel);
  const catalog = toPreviewCatalog({ mode, services, offerings });
  // The preview's link to the other page: present when that channel is
  // declared AND has something bookable — the public page's rule (§3.5).
  const present = presentMode(declared, has);
  const crossLink =
    channel === "appointments" && present.offersRentals && has.spaces ? { href: "#", label: SPACES.crossLink }
    : channel === "spaces" && present.offersAppointments && has.services ? { href: "#", label: APPOINTMENTS.crossLink }
    : null;
  const [pages, pageSections] = await Promise.all([
    getPageStates(branding.orgId),
    getPageSectionsEntitlement(branding.orgId),
  ]);
  const page = pages[channel] ?? EMPTY_PAGE_STATE;
  const switchable = declared.offersAppointments && declared.offersRentals;

  return (
    // Wider than the other settings pages: the preview must be able to show
    // the split layout (≥ 48rem of page column) at desktop.
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 p-6">
      <PageIntro>The page clients book you on. Arrange its sections, brand it, then publish.</PageIntro>
      {switchable ? <PageSwitch value={channel} /> : null}
      <BookingPageBuilder
        // Re-mount per page: the draft hook is seeded once from its props.
        key={channel}
        channel={channel}
        crossLink={crossLink}
        branding={branding}
        scheduling={scheduling}
        appUrl={env.NEXT_PUBLIC_APP_URL}
        supabaseUrl={env.NEXT_PUBLIC_SUPABASE_URL}
        previewServices={catalog.services}
        previewOfferings={catalog.offerings}
        // The preview's Team section shows the real active roster (public shape: never email).
        staff={staff.filter((s) => s.active).map(({ id, name, slug, color }) => ({ id, name, slug, color }))}
        initialPage={{ draft: page.draft, published: page.published }}
        pageSections={pageSections}
        mode={mode}
      />
    </div>
  );
}
```

`PageProps<"/booking-page">` gives `searchParams` as a promise of `Record<string, string | string[] | undefined>` — `parsePageChannel` takes `unknown`, so no cast.

- [ ] **Step 4: The builder renders its page's URLs and link**

In `booking-page-builder.tsx`:

- Props: add `crossLink: RenderContext["crossLink"];` next to `channel: PageChannel;` and destructure it.
- Import `channelPath, channelUrl` from `@/lib/booking/url` (replacing the `bookingPath, bookingUrl` import if nothing else uses them — `hostLabel` stays).
- The preview URL: `const url = \`${host}${channelPath(previewHandle, channel)}\`;`
- `ctx`: replace `crossLink: null,` (Task 5's interim) with `crossLink,`.
- The live URL passed to `SectionsPanel`: `liveUrl={scheduling.handle ? channelUrl(appUrl, scheduling.handle, channel) : null}`.

Nothing else in the builder changes: `mode` is already the prop the route now feeds single-channel, and `TemplatePicker` / `SectionsPanel` / `SectionInspector` take it as before.

- [ ] **Step 5: Verify and walk it**

Run: `npm run verify`
Expected: clean.

In the dev server, signed in as the demo org (both channels):
- `/booking-page` → *Appointments page · Spaces page* switch above the tabs, Appointments selected; the preview header shows the spaces cross-link (inert); "View live page" → `/demo`; the add-section palette has no Spaces entry.
- `/booking-page?page=spaces` → Spaces selected; the default composition with the widget listing the demo spaces; palette has Spaces, no Services/Team; "View live page" → `/demo/spaces`; the "This is the default page" hint shows.
- Edit the spaces page (add a hero, type a headline) → autosave "Saved"; reload → the edit is there; switch to Appointments → the Studio page is untouched. Publish the spaces page → `/demo/spaces` shows the hero.
- `/booking-page?page=rentals` → falls back to Appointments (no switch flicker).
- Sign in as an appointments-only org (create one through `/onboarding` if none exists locally) → no switch; `?page=spaces` falls back to Appointments.

- [ ] **Step 6: Commit**

```bash
git add src/features/booking-page/studio src/features/orgs/vocab.ts "src/app/(dashboard)/booking-page/page.tsx"
git commit -m "feat(booking-page): the studio edits one page at a time — ?page= switch, single-channel mode, per-channel live URL

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Whole-branch verification, QA, spec amendments, memory

**Files:**
- Modify: `docs/superpowers/specs/2026-08-28-channel-pages-and-starter-design.md` (amendments), `graphify-out/` (via `graphify update .`)

- [ ] **Step 1: Full verification**

Run: `npm run verify && npm run test:integration`
Expected: both clean. Paste the summary lines (test counts) into the PR description.

- [ ] **Step 2: Browser QA (spec §6 items 2–5), on `localhost`**

Record pass/fail per line in the PR description:
1. Both-channel org (demo): `/demo` appointments page with cross-link; `/demo/spaces` spaces page with reverse link; `/demo?channel=spaces` → 307; builder switch works both ways; publishing one page leaves the other's draft alone.
2. Spaces-only org: create one via `/onboarding` (pick Spaces), add a space (its first unit comes free) → `/<handle>` is the spaces page with no cross-link; `/<handle>/spaces` renders the same page and its `<link rel="canonical">` (view source) points at `/<handle>`; the builder shows no switch and no Services/Team in the palette.
3. Migration: the demo org's published Studio page is byte-identical after 0059/0060 (`select published from booking_pages where channel = 'appointments'` for the demo org equals what was there before — compare against `git stash`-free evidence: the page renders identically and the row's `published_at` is unchanged); its Spaces section no longer renders on `/demo`.
4. Team member named "Spaces" → the dialog pre-fills `spaces-1`; typing `spaces` by hand → "That link name is already used."
5. Links & embeds (`/embed` page, both-channel org): "Spaces only" Copy link yields `/demo/spaces`; "Appointments only" yields `/demo`; the Copy embed snippets still carry `?channel=`.

- [ ] **Step 3: Keep the graph current**

Run: `graphify update .`

- [ ] **Step 4: Amend the spec**

Append to the spec an `## Amendments (2026-08-28, at execution)` section:

```markdown
## Amendments (2026-08-28, at execution)

- `channelPath` / `channelUrl` live in `lib/booking/url.ts`, not `channel-pages.ts` — `bookingLink` needs them and `channel-pages.ts` imports `url.ts` (a cycle otherwise). §3.1 / §3.6 read accordingly.
- The `channel` column keeps its `default 'appointments'` (schema and DB agree; only the RPCs write, and they always name the channel). §2 step 3 ("drop the column default") is withdrawn — dropping it would drift from the Drizzle schema on the next generate.
- The 0060 backfill is verified at migration time (psql, plan Task 3 step 5) and by QA item 3, not by an integration test: the harness cannot re-run a migration against seeded rows. §6 reads accordingly.
- `listPublicCatalog` is memoised per request (`react.cache`) so `generateMetadata` and the page resolve the channel from one read.
- The orphan-image sweep (`cleanupOrphans`) reads every page of the org — draft and published, both channels — before deleting; a one-page sweep would have removed images only the other page references.
```

- [ ] **Step 5: Commit and open the PR**

```bash
git add docs/superpowers/specs/2026-08-28-channel-pages-and-starter-design.md graphify-out
git commit -m "docs(specs): channel pages — execution amendments

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push -u origin feat/channel-pages
gh pr create --base main --title "feat(booking-page): one page per channel — /<handle> + /<handle>/spaces, per-channel builder, cross-links" --body-file - <<'EOF'
Slice 1 of docs/superpowers/specs/2026-08-28-channel-pages-and-starter-design.md (§1–§4, §8 item 1). Slice 2 (the business-type starter) follows on top.

- `booking_pages` one row per channel (0059 shape, 0060 backfill + RPCs with `p_channel`); H4 → 0061
- `/<handle>` = appointments when a service is bookable, else spaces; `/<handle>/spaces` always the spaces page; `?channel=spaces` → 307
- builder edits one page (`?page=`), single-channel mode, *Appointments page · Spaces page* switch for both-channel orgs
- automatic cross-link between the two pages (header / hero / above widget)
- `spaces` / `appointments` reserved staff slugs; channel links become paths (embeds keep `?channel=`)
- supersedes stranded PR #75 (never reached main)

Verify: <paste>. Integration: <paste>. QA: <paste the 5 lines>.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

- [ ] **Step 6: Update memory** (outside the repo): `channel-pages-starter-notes.md` — slice 1 BUILT, PR number, any deferred items found in review; `MEMORY.md` index line.

---

## Self-review

**Spec coverage.** §1 vocabulary → Task 1 (+ vocab in Tasks 5, 8). §2 table/migrations/RPCs → Task 3; queries/actions/`getPageStates` → Task 4; orphan sweep → Task 4. §3.1 rule → Task 2; §3.2 root + redirect, §3.3 spaces route + canonical, §3.4 staff page, §3.7 both-org behaviour (falls out of `applyChannel` + `publicSections`) → Task 6; §3.3 reserved slugs → Task 7; §3.5 cross-link → Task 5 (rule/component) + Task 6/8 (values); §3.6 links → Task 1, metadata → Task 6. §4.1–4.3 → Task 8; §4.4 checklist → Task 4. §6 unit tests → Tasks 1, 2, 5, 6, 7; integration → Tasks 3, 4; QA 2–5 → Tasks 6, 8, 9. §8 delivery item 1 → this plan; §9 numbering → Task 3 step 1.

**Deliberate deviations** (recorded in Task 9's amendments): `channelPath` location; column default kept; backfill verified manually; `listPublicCatalog` cached; orphan sweep across pages. `templatesFor` is untouched (single-channel mode already hides Venue for an appointments page) — slice 2 replaces it.

**Type consistency.** `PageChannel` from `features/booking-page/channel` everywhere; `Has`/`ChannelPage` from `lib/booking/channel-pages`; `RenderContext["crossLink"]` is the one link type; `getPageStates` returns `Partial<Record<PageChannel, PageDraftState>>` (Tasks 4, 8); `usePageDraft(initial, channel)` (Tasks 4, 8); actions take `{ channel, doc }` / `{ channel }` (Tasks 4 hook + actions); `renderChannelPage({ org, handle, page, catalogue, searchParams })` (Task 6 both routes); `EMPTY_PAGE_STATE` exported in Task 4, used in Task 8.
