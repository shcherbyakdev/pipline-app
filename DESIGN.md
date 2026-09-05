---
name: Booklo
description: Product-first periwinkle (aave.com-referenced) — one white-and-lavender world for the landing, auth, admin and booking pages
colors:
  ground: "#fefefe"
  ink: "#252228"
  card: "#ffffff"
  panel: "#f4f2fb"
  panel-hover: "#eeecf8"
  sidebar: "#f6f4fb"
  text-secondary: "#5c5964"
  text-subtle: "#686472"
  stage-wash: "#e2dcfb"
  hairline: "rgb(37 34 40 / 0.08)"
  hairline-strong: "rgb(37 34 40 / 0.12)"
  kind-time: "#6975e2"
  kind-time-soft: "#f1f1ff"
  kind-time-text: "#4b5bc4"
  kind-space: "#01d062"
  kind-space-soft: "#e3f9ec"
  kind-space-text: "#0c7039"
  kind-class: "#ff3d8f"
  kind-class-soft: "#ffe6f0"
  kind-class-text: "#b61a60"
  kind-stay: "#ff9500"
  kind-stay-soft: "#fff2df"
  kind-stay-text: "#a04a06"
  kind-embed: "#8b5cf6"
  on-kind: "#252228"
  brand: "#6975e2"
  brand-text: "#4b5bc4"
  success: "#01d062"
  danger: "#e11d48"
  danger-soft: "#fde7ef"
  night-ground: "#151318"
  night-card: "#1d1a21"
  night-panel: "#26232c"
  night-ink: "#f2f0f7"
  night-hairline: "rgb(242 240 247 / 0.09)"
typography:
  display:
    fontFamily: "Inter, system-ui, sans-serif"
    fontWeight: 500
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
  ui:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
  wordmark:
    fontFamily: "Outfit, Inter, sans-serif"
    fontWeight: 600
    letterSpacing: "-0.04em"
  mono:
    fontFamily: "Geist Mono, ui-monospace, monospace"
rounded:
  control: "9999px"
  fragment: "10px"
  card: "14px"
  panel: "18px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.card}"
    rounded: "{rounded.control}"
    height: "32px"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
  input:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.fragment}"
    height: "32px"
  card:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.card}"
---

## Overview

Booklo is drawn as one **product-first periwinkle** world (aave.com-referenced) everywhere: the marketing
landing, auth, the admin app and the hosted booking pages share a single
palette declared on `:root` in `src/app/globals.css` (the `.marketing` block
holds the same values plus landing-only notes). Warm off-white ground, white
cards on low-alpha hairlines, near-black ink as the only control colour.
Colour appears **only where it names a kind of booking** — appointments periwinkle,
spaces green, classes pink, stays orange, embed purple — never in the chrome.
`.dark` is the same world at night (warm near-black, off-white ink pill),
reachable per browser via Settings → Interface theme and by `/book` pages
whose widget theme is dark; `.book-auto` follows the visitor's system.

## Colors

- Components use **semantic tokens only** (`bg-background`, `bg-card`,
  `border`, `text-muted-foreground`, `text-subtle`, `bg-kind-time-soft`,
  `text-kind-space-text`…). Never hex values in components.
- A bare `border` class resolves to the hairline token via the base layer in
  globals.css — do not add explicit grey border colours.
- Kind colours as text always use the `-text` variants (>= 5:1 on their own
  soft tints, not just the ground). Soft tints are for dots, discs, bars and
  event surfaces.
- Text sitting ON a solid kind colour (chips, badges) is `text-on-kind` —
  ink, never white: the kind colours are bright in both themes, so white
  fails AA on them (2.2:1 on stay orange) while ink holds 5-7.8:1.
- Secondary text is `text-muted-foreground` (#5c5964); captions and tick
  labels are `text-subtle` (#686472). Never lighter greys for readable text.

## Typography

- **Inter for everything that is read in the product**: body at 400, UI
  labels at 13px/500.
- **Outfit 500 for landing display type** (`font-display`): the hero (54px
  desktop, 32px phones) and section H2s (44px desktop) on the marketing
  pages only. Admin headlines stay Inter.
- **Hosted booking pages** (`features/booking-page/render/type.ts`) set
  display at weight 500 with -0.025em tracking in the org's own widget
  font (`widget-fonts.ts`; "system" is the visitor's UI face, Geist and
  five others on offer): cover H1 32/40px, section H2 24px, lead and
  quotes 17px, body 16/400. Inside the widget, a step heading (the
  service, the day) is 14px/500 ink (`STEP_LABEL`), the way back a step is
  the muted "change" link (`CHANGE_LINK`), values are tabular.
- **Outfit Semibold for the "booklo" wordmark** (`BookloWordmark`).
- **Geist Mono only where a value is a value** (handle URLs, kbd hints, tick
  labels). Monospace is never a "technical" costume.
- Page titles live in the admin top bar (14px/600); pages don't render their
  own `<h1>`.

## Layout

- Admin shell: 236px soft-grey sidebar (`bg-sidebar`) with hairline, 56px
  blurred top bar, content on the ground with per-page `max-w-2xl`/`max-w-6xl`
  centered columns.
- List rows are white cards (`bg-card rounded-xl border px-4 py-3`) that
  stack to a column under `sm:` — actions wrap below the text on phones.
- Roster tables (Team, 2026-09-01, Linear-referenced): flat rows on the
  ground — no card per row — under a muted 12px column-header row with a
  hairline. Header and rows share one grid template; the full grid needs
  `lg:` (its fixed action/role tracks crush the `fr` columns below that),
  so below `lg:` rows stack with `divide-y` hairlines and actions always
  visible. Row hover is `bg-muted/50`; per-row actions are opacity-revealed
  on hover/focus-within. Page column is `max-w-6xl`.
- Public booking pages (2026-09-06, the landing's hero card made real):
  the admin's panel shell — the soft ground (`bg-sidebar`) with the page
  as **one floating panel** on it (`PAGE_PANEL_CLASS` in page-renderer.tsx:
  `bg-background`, hairline, `--shadow-card`, 2r corners), the badge and
  the language links below it on the ground. Column `BOOK_COLUMN_CLASS`
  (book-shell.ts), width from `pageContainerClass` (`max-w-xl`, split
  `max-w-5xl`); the studio preview and a person's page compose exactly the
  same. The widget's own themes (`.wt-light` / `.wt-dark` in globals.css)
  are the app's light and night tokens, plus `--widget-panel` (the soft
  panel: `--secondary`) and `--widget-card` (the white control), so an
  embed on a matching host draws the same world. Vocabulary
  (render/type.ts): a month grid or a receipt sits on a **panel**
  (`wt-panel`); a free time, a duration, a stay length is a **chip**
  (`wt-chip`: card fill, hairline, lift on hover); a day with free times
  is an accent-**tinted disc** (`wt-tint`, the org's accent — or, without
  one, the channel's kind colour: appointments periwinkle, spaces green)
  and the pick is the accent fill (`wt-primary`); a service, a space, a
  unit, a free stay is a **row** card (`ROW`, price right, lift on hover,
  accent ring when picked). Paging is a pair of white discs
  (`PagerDiscs`), the timezone note carries the globe. The header is the
  identity block: a 44px disc (logo, or the initial on the accent) beside
  the name at 17px/500 and the tagline. No accent rule under it.

## Elevation & Depth

The landing hero's stage takes the lavender wash: a top-to-bottom gradient
from `#f5f3fe` to `stage-wash` (#e2dcfb), the reference's white-into-
periwinkle fade (`.stage-wash` in globals.css). It is the only gradient in
the system.


Two shadows only, defined as tokens and used via `shadow-(--shadow-card)` /
`shadow-(--shadow-lift)`:

- `--shadow-card`: `0 1px 2px rgb(37 34 40 / 0.04), 0 16px 40px -20px rgb(37 34 40 / 0.18)` — overlays (dialogs, popovers, menus, sheets).
- `--shadow-lift`: `0 1px 2px rgb(37 34 40 / 0.05), 0 6px 16px -8px rgb(37 34 40 / 0.14)` — small lifted elements (active nav row, segmented pill, search pill).

Overlay scrims are a near-opaque ink wall (`bg-scrim/90` — `--color-scrim`
is the light world's ink, deliberately not theme-flipped so the scrim stays
dark at night), no backdrop blur; the page behind a dialog or sheet is not
meant to be visible (ruled 2026-09-01).

## Shapes

The shape rule, everywhere: **pills for controls** (buttons, segmented
switches, search), **10–14px for fragments** (inputs 10px, cards/menus 14px),
**18px+ for panels** (dialogs, auth card). Checkboxes/switches keep their
small radii. Inside button/input groups, pills square off to the group's
radius.

Hosted booking pages derive every shape from the org's corner setting
(`--widget-radius`, 0/8/12px — "subtle" is the app's fragment radius):
controls r, cards and panels 2r (`wt-r2`), discs `wt-round`. The widget
theme squares every `rounded-*` to r (globals.css), so those two classes
(or an inline style, as the stay picker's band does) are the only way to
another radius on a public page.

## Components

- **Buttons** (`components/ui/button.tsx`): ink pill primary, soft-grey
  secondary, hairline outline, ghost. Press = `scale(0.98)`; transitions
  150ms `ease-strong`.
- **Segmented switches** (`components/ui/segmented.ts`): grey pill track,
  active item lifted onto a white card with hairline + lift shadow. One idiom
  for links, radios and tabs — import `SEGMENTED_NAV_CLASS` /
  `segmentedItemClass`, never re-derive.
- **Sidebar** (`components/shell/sidebar-body.tsx`): 13px/500 rows on 8px
  radii; the active row is a white card, idle rows tint on hover.
- **Inputs**: white fill, hairline border, ink focus ring at 30%.
- **Overlays**: `rounded-3xl` p-0 dialog panels (the Linear-style
  header/body/footer zones in `ui/dialog.tsx`; plain confirm dialogs stay
  `rounded-2xl`), `rounded-xl` popovers/menus, 150ms `ease-strong`
  enter/exit from 95% scale.
- **Switches** (`components/ui/switch.tsx`): the one on/off idiom — grey
  track, brand-checked like the checkbox; used on roster rows, dialog
  toggles and Settings.

## Do's and Don'ts

- Do use `--ease-strong` (`cubic-bezier(0.23, 1, 0.32, 1)`) for state
  transitions; on-screen movement takes `--ease-in-out-strong`.
- Do keep admin motion at 150–250ms, state-driven, transform/opacity only;
  every loop or entrance needs a reduced-motion variant.
- Don't add page-load choreography to admin surfaces.
- Don't put kind colours in chrome, nav, or buttons; ink pills are the
  controls, and the brand blue appears only as focus rings, checked controls
  and the active nav icon.
- Don't hand grey borders, `transition-all`, pure `#000`/`#fff`, or a second
  accent into any surface.
- The landing is light except **one dark band**: the final CTA section opts
  into the `.dark` scope (plum night) and carries `data-nav-dark`; the sticky
  nav inverts while over it. No other marketing surface goes dark.
