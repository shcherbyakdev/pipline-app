# Share links — a link shows exactly what you chose

**Date:** 2026-09-16 · **Status:** approved in chat, building on `feat/share-links`

## Problem

A business with several spaces (or services) wants a booking link or embed
for one of them, or for a chosen few. Today `?space=<id>` / `?service=<id>`
only pre-select: the hosted page still lists every card and the widget keeps
its "Change" link, so the visitor wanders to the rest. Only the per-person
link (`/<handle>/<slug>`, embed `?staff=`) truly narrows.

## The model

A link or embed has one of three shapes. Nothing is stored — the link is the
configuration; to show something else, make another link.

| Shape | Address | The visitor sees |
|---|---|---|
| Whole page | `/<handle>` | Everything |
| One person | `/<handle>/<slug>` · embed `?staff=<slug>` | Only their services, no team step (unchanged) |
| Selected services or spaces | `?service=<id>,<id>` · `?space=<id>,<id>` | Only those. One item opens straight into it, no "Change". Several: the visitor picks among those only |

- A single-item address is byte-identical to the old link, so anything
  already pasted keeps working — it simply starts narrowing.
- Hosted page: the Services / Spaces section lists only the chosen items;
  the Team section lists only people who offer a chosen service.
- Degrade rule (the embed's existing one): ids that are unknown, inactive,
  hidden by the plan cap, equipment add-ons, or from the other channel are
  dropped; when none survive the whole page shows. Never a 404, never an
  empty widget. A handle rename keeps the query on the redirect. `?lang=`
  composes as before.
- A person plus a service list still composes on the embed as before (the
  pinned roster wins); the UI does not offer the combination.
- Saved, named short links (`/<handle>/rooms`) need a migration — deferred.

## Where a business manages it

- **Website embed › Code › Show** is the one place to build any link or
  snippet: *Booking page* · each team member · *Selected services* (or
  *Selected spaces* for a spaces business). Picking *Selected…* reveals a
  checklist; the snippet, the bare address, *Copy link* and the live preview
  follow the ticks. Nothing ticked = the whole page, and the hint says so.
  The select only appears when there is something to choose (people, or
  more than one service / space).
- **Service, space and member pages** keep *Copy link* (now a narrowed link)
  and *Embed* (lands on the embed page with that item ticked).
- Onboarding's copy-link stays the whole page.

## Code

- `lib/booking/url.ts`: `LinkTarget = { staff } | { services: id[] } | { spaces: id[] } | null`;
  `targetQuery` comma-joins.
- `features/booking-page/narrow-catalogue.ts` (replaces `initial-service.ts`):
  `parseIds(param)` and pure `narrowCatalogue(catalogue, { services, spaces })`
  → narrowed lists + the initial pick when exactly one item was named. Used
  by `channel-page.tsx`, `[handle]/[staffSlug]/page.tsx`, `embed/[handle]/page.tsx`
  and the embed page's `previewFor`.
- `features/orgs/link-rows.ts`: `showOptions`, `pickTarget`, `initialPick`
  replace `linkRows` / `initialRowKey`; `embed-code.tsx` gains the checklist;
  `widget-appearance.tsx` derives the preview from the pick.
- Rails on the service and space pages use the list-shaped target.
- Copy in en / pl / uk. Unit tests: URL builder, `parseIds` + `narrowCatalogue`,
  `showOptions` / `pickTarget` / `initialPick`, `previewFor`, snippet title.
