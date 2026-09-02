# Widget templates (appointments) — design

**Date:** 2026-09-02 · **Branch:** feat/public-page-main · **Status:** approved in chat, BUILT 2026-09-02 (§1–§10), reviewed (10 findings fixed), PR opened

## 1. Reframe

Booklo is an appointment-widget builder, not a site builder. A "template" is
therefore **how the widget shows free times**, not a page composition. The
page-composition templates (Main, the eight before it) and the business-type
cards go; the section palette stays for owners who want more on the page,
and Classic (name + widget) stays the page default.

Decisions (user, 2026-09-02): default = **Calendar + times**; ship all four
presentations; the choice is an **org widget setting** shared by the hosted
page and the website embed; the starter is rebuilt around widget templates.
Spaces keep their own flows; a spaces template set is a later slice.

## 2. The four presentations

| id | name | what the visitor sees | window fetched |
|---|---|---|---|
| `calendar` | Calendar + times | Month grid, bookable days marked; pick a day, its times list beside it (below on phones). Month arrows. | the month: from max(today, 1st) to month end (≤ 31 days) |
| `week-list` | Week list | Today's widget: seven day rows with time chips, week arrows. | 7 days from the page start |
| `week-columns` | Week columns | Mon–Sun columns, times stacked under each header, week arrows. Below ~28rem of width it falls back to the week list. | 7 days from Monday |
| `next-available` | Next available | Soonest times first, grouped by day (Today / Tomorrow / date), "Show more", "Later dates". | 28 days from the start |

The first look after a service (or person) is settled stays a 28-day fetch;
if the earliest free time lies beyond the layout's home window, the widget
opens on the window that contains it (`windowAround`). One rule, four
layouts (`features/scheduling/slot-paging.ts`).

## 3. Setting

`WidgetThemeConfig.layout?: SlotLayout` (orgs.widget_theme JSON, next to
theme / radius / font). Absent = never chosen: the starter opens on a fresh
appointments page. Rendering resolves absent to `calendar`
(`resolveLayout`). Editable in the studio starter/picker, the studio
Settings tab and Website embed settings; the embed and every hosted page
read it.

## 4. Widget

`BookingWidget` takes `layout`. After a service is picked it renders the
shared header (service name, change link), the person switch, then the
layout component, then the timezone notes. `TimeSlotGrid` is the week list
and stays as it is (the rentals hourly flows use it too). New:
`MonthCalendar`, `WeekColumns`, `NextAvailable` in
`features/scheduling/components/slot-layouts/`. Details form and
confirmation are unchanged.

## 5. Studio

Starter (fresh appointments page): "How should clients pick a time?" —
four cards, live preview of the real widget with canned slots, Continue
saves the layout org-wide (then the first-service step when the channel
has nothing bookable). Picker button "Widget layout" reopens it; no
replace-draft confirm (the page document is not touched), no look
checkbox. Spaces channel: the starter opens only for the first-space step.

## 6. Removed

`templates.ts`, `business-types.ts`, their tests, the `sample` copy,
`applyLook` / `skinDefault`, the replace-draft confirm in the picker.

## 7. Tests

Pure: window model per layout (`slot-paging.test.ts`), layout parse and
resolve (`widget-theme.test.ts`), starter reducer and fresh-page rule
(`starter-state.test.ts`), starter copy guard (`copy.test.ts`). Visual:
Playwright screenshots of the four layouts on `/demo-studio` at 1440 and
390, the starter dialog, contrast sweep.

## 7b. Persistence

`orgs.widget_theme` is written only through the `update_org_widget_theme`
RPC, which whitelists keys and enum values in SQL. Migration
`0067_widget_layouts.sql` adds `layout`, `stayLayout` and the `geist` font;
`s3-rpc.integration.test.ts` pins it. Any future key needs the same pair:
zod input plus RPC whitelist.

## 8. Spaces (added 2026-09-02, user decisions)

- **Hourly spaces** (rooms, studios, gear by the hour) share the
  appointments setting: after the duration pick their start times use the
  same four presentations through one shared `SlotPicker`. The hourly slot
  action's window cap rises from 10 to 31 days (one context load, in-memory
  compute — the same shape as appointments) so a month window fits.
- **Stays** (nights and days) get their own setting
  `WidgetThemeConfig.stayLayout` — `one-month` (default), `two-months`
  (today's picker), `fields` (check-in / check-out fields that open the
  month grid), `next-free` (the soonest free windows that fit the minimum
  stay, one tap picks the dates; derived client-side from the range
  availability with `validateStay`).
- **Starter on a spaces page**: the layout step shows a group per kind the
  org rents — "Stays" cards when a nights/days space exists, the shared
  "Times" cards when an hourly one does — each group a radio; Continue saves
  every group's pick. Fresh = nothing published, default draft, and a group
  still unchosen (or nothing to rent yet → first-space step). The picker
  button offers the same groups.
- **Previews**: the rental flows take canned data (`preview`) so the starter
  can show them live; the widget opens on the first space of the group's
  kind.
- **Settings**: a "Stays layout" select beside "Widget layout" on the studio
  Settings tab and Website embed, shown when the org offers spaces.

## 9. One appearance per surface (added 2026-09-02, user ruling)

The hosted booking page and the website embed share only the widget UI,
never their settings. `orgs.page_theme` (0068, backfilled from
`widget_theme`) is the page's appearance; `widget_theme` stays the embed's.
One RPC `update_org_surface_theme(org, surface, theme)` writes either with
the 0067 validation; `update_org_widget_theme` remains as the embed's
name. One action `updateSurfaceTheme({ surface, theme })`. One component
`AppearanceFields` (theme, corners, both layouts, font, colour overrides
with the contrast guard, badge) renders on Website embed (explicit Save)
and on the studio Settings tab (saved as you go, a blocked contrast pair
previews but does not save). The starter and the "Widget layout" picker
write the page surface. Emails read the page's badge setting (their links
land on the page). `badgeToggle()` is the shared server helper for the
badge's plan gate.

## 10. The embed is one channel (added 2026-09-02, user ruling)

Like the hosted pages, an embed never mixes appointments and spaces.
`embedChannel(has, requested)` (lib/booking/channel.ts) resolves
`/embed/<handle>` to the requested channel when it has something bookable,
else the front door (appointments when a service is bookable, else
spaces). The Website embed page gets an Appointments / Spaces switch for a
both-channel org: the snippet names the channel explicitly
(`?channel=`) and the preview shows only it; the person pin applies to
appointments. Links & embeds lists "Appointments page" and "Spaces page"
rows for a both-channel org instead of a whole-catalogue row. The iframe
title of a plain both-channel embed is "Book an appointment" (its front
door).
