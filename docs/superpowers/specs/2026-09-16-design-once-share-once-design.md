# Design once, share once — Booking page studio and Website embed

**Date:** 2026-09-16 · **Status:** approved in chat (critique 26/40 studio, 25/40 embed;
snapshot `.impeccable/critique/2026-09-16T14-13-28Z__src-app-dashboard-embed-page-tsx.md`) ·
building on `feat/design-once`, stacked on `feat/share-links` (#163)

## Problem

The two admin pages under Share are built from the same primitives but run on
different models, and the copy on each spends its words pointing at the other:

1. Two stored widget looks (`orgs.page_theme`, `orgs.widget_theme`), the same
   `AppearanceFields` mounted twice under two names and two save models.
2. The studio's Settings tab mixes four save models: page layout → Publish,
   address → Save, logo/accent → auto-save, widget → Publish.
3. A fresh page's starter cannot be dismissed — "Leave for now" and X navigate
   to Bookings.
4. The page link is a ghost button on the embed page or a copy icon in a card.
5. Sections/Settings vs Code/Style; the sun/moon toggle means two things; the
   preview toolbar overflows at phone width.

Best practice (Calendly, Cal.com, Squarespace, Linear): branding stored once;
embed is a generator whose style choices are snippet parameters; draft/Publish
for content; settings save instantly.

## Design

- **One look.** `page_theme` is the widget's look everywhere. The public embed
  reads it. `widget_theme` stops being read (no migration; the column stays).
  The embed page loses its Style tab and theme editor. Its one style choice is
  **Theme** (Auto / Light / Dark) written into the snippet as `?theme=`; the
  public embed applies it over the stored theme. Auto keeps today's behaviour.
- **One save model per page.** Studio › Style (renamed from Settings) keeps
  only what publishes with the page: Page layout and Widget style. Address,
  timezone, currency, language (SchedulingSettingsForm) and logo + accent
  (BrandingForm) move to Settings › Business, where every card saves on its
  own. Studio = draft → Publish. Embed saves nothing.
- **Share is real.** Copy link beside the Live pill in the studio header (the
  whole page). The embed page's third button says "Copy page link".
- **The starter never traps.** Closing it (X, Esc, backdrop) applies the
  current selection to the draft — the highlighted defaults if untouched —
  and shows the studio. The "Leave for now" button is deleted. Compare layouts
  stays as the way back.
- **Same skeleton, same words.** Both pages: intro row, left panel, shared
  preview. Studio tabs: Sections · Style. Embed: no tabs, just Code. Widget
  card titled "Widget style" with no cross-page hint. Preview toolbar wraps.

## Files

`studio/settings-tab.tsx`, `studio/booking-page-builder.tsx`, `studio/starter-dialog.tsx`,
`orgs/components/widget-appearance.tsx`, `embed-code.tsx`, `widget-embed-snippet.ts`,
`orgs/link-rows.ts` (EmbedPick.theme), `lib/booking/url.ts` (embedSrc theme),
`app/embed/[handle]/page.tsx`, `app/(dashboard)/embed/page.tsx`,
`app/(dashboard)/settings/page.tsx`, `components/live-preview/live-preview.tsx`,
messages en/pl/uk, tests for url + snippet + link-rows, `scripts/qa-design-once.mjs`.
