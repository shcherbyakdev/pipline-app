# Scheduling S3 — Widget Customization + Embed — Design

**Date:** 2026-08-16
**Status:** Approved
**Slice:** S3 of the scheduling pivot (after S1 #22, S2 #23, calendar slice #24/#25). Roadmap: `2026-08-13-scheduling-pivot-vision-and-roadmap-design.md`.

## Goal

Make the booking widget distributable: brand-themable, embeddable on a client's own site via a copy-paste snippet with auto-resize, with a live preview in Settings. Folds in two earmarked debts: resend-manage-link (S2) and the a11y pair (S1).

## Scope decisions (user-confirmed)

- **Embed = iframe + hosted resize script** (`/embed/[handle]` + `/embed.js`, postMessage height). No web-component/script-injection variant.
- **Brand knobs**: existing logo + accent stay; S3 adds `theme` (light/dark/auto), `radius` (none/subtle/round), curated font list, optional background/text hex overrides with a contrast guard, and a `hidePoweredBy` toggle (embed-only footer).
- **Accent applies inside the widget** (slot buttons, confirm button), not just the page header.
- **Live preview** in Settings renders the real widget with unsaved form values.
- **Architecture: Option A** — CSS-variable theme layer (`WidgetTheme` wrapper), one mechanism for hosted page, embed, and preview.
- **Carried-overs folded in**: resend-manage-link, a11y pair.

## Theme layer

- `WidgetThemeConfig`: `{ theme: "light"|"dark"|"auto", radius: "none"|"subtle"|"round", font: <curated id>, background?: hex, text?: hex, hidePoweredBy: boolean }`. All fields defaulted; stored config may be null (all defaults).
- `WidgetTheme` (component) maps config → CSS custom properties on a wrapper div: `--widget-accent` (from existing `accent_color`), `--widget-bg`, `--widget-text`, `--widget-radius`, font-family class. `auto` theme resolves via `prefers-color-scheme`.
- Widget components consume tokens (one-time class swap in `booking-widget.tsx`); every surface then renders `<WidgetTheme config><BookingWidget/></WidgetTheme>`.
- **Fonts**: curated list of six via `next/font`, loaded only on widget surfaces (hosted, embed, preview) — never the dashboard shell: `system` (default stack), `inter`, `dm-sans`, `lora`, `space-grotesk`, `ibm-plex-mono`.
- **Contrast guard**: pure `contrastRatio(bg, text)`; the form warns < 4.5:1 and blocks save < 3:1. The RPC re-validates format server-side (guard is UX; RPC is the boundary).

## Storage

- New `orgs.widget_theme` jsonb column, null = defaults. Written ONLY via new `update_org_widget_theme` definer RPC (update_org_branding idiom): org-membership check, server-side validation of enums, `^#[0-9a-f]{6}$` hex fields, font-id whitelist, boolean. `orgs` stays select-only for authenticated.
- Public surfaces read it alongside the existing branding fetch.

## Embed

- **Route `/embed/[handle]`**: chrome-less — optional compact logo row, themed widget, "Powered by" footer link unless `hidePoweredBy`. Same public data path and neutral not-available state as `/book/[handle]`. No cookies/auth. Explicitly frameable by third-party sites (scoped exception to any global frame-blocking headers; dashboard keeps its protections).
- **Auto-resize**: embed page observes `document.body` with `ResizeObserver`, posts `{ type: "rollout-resize", height }` to `window.parent` on change.
- **`public/embed.js`** (served `/embed.js`, static, cacheable, no deps, ~30 lines): finds iframes by `data-rollout-embed`, verifies each message's `source === iframe.contentWindow` before applying height (no spoofed-height DoS).
- **No SRI on the snippet's script tag — deliberate.** Subresource Integrity pins a hash, which is right for third-party CDN assets but would break every customer's pasted snippet each time we ship an `embed.js` update (the script is first-party and evergreen, the Calendly/Stripe model). Mitigation: served from our own origin over HTTPS, no external CDN, ~30-line auditable surface.
- **Snippet UI**: Settings "Embed" card (shown once a handle is published) with copy button:

```html
<iframe data-rollout-embed src="https://<app>/embed/<handle>"
        style="width:100%;border:0" title="Book an appointment"></iframe>
<script src="https://<app>/embed.js" async></script>
```

## Live preview

- Branding/theme form gains a side-by-side (stacked narrow) preview: real `WidgetTheme` + `BookingWidget` fed by the form's unsaved values, on a light/dark backdrop.
- Widget gains a `previewData` prop (canned services/slots, no network); preview mode never fires real queries or creates bookings.

## Carried-overs

- **Resend manage link**: new `rotate_booking_token` definer RPC (org-scoped, confirmed + future only) mints a fresh token hash (invalidates the old link); server action emails the manage URL; honest three-way toasts; disabled with "no email on file" hint for emailless bookings. Surfaced in the calendar detail dialog and the bookings list rows.
- **A11y pair**: widget slot-flow keyboard/focus order + `aria-live` on loading/empty slot states; availability editor labeled controls + visible focus. Embed inherits widget fixes.

## Error handling

- Theme save: inline field errors from zod; contrast block with explicit ratio message; RPC failure → generic error toast (established idiom).
- Embed for unknown/unpublished handle: neutral not-available page (no org enumeration signal beyond the hosted page's existing behavior).
- Resend link: RPC miss (cancelled/past/foreign booking) → uniform failure message; email transport failure → honest warning toast.

## Testing

- **Unit**: contrastRatio math; config→CSS-var mapping (incl. defaults and auto theme); snippet generator; `widgetThemeInput` zod shape.
- **Integration**: `update_org_widget_theme` valid/invalid/non-member; `rotate_booking_token` rotates hash + kills old token + rejects cancelled/past/foreign; embed data fetch for unknown handle.
- **Manual**: local static HTML fixture embedding the iframe to verify resize + theming cross-origin-style.

## Out of scope

- Script-injection/web-component embed.
- Free-form font URLs or arbitrary palette controls beyond bg/text.
- Editing existing bookings' duration (user-deferred), month/year calendar views (S5), Google Calendar (S4).

## Post-implementation

- `graphify update .` (repo rule).
