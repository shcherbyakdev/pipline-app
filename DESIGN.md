---
name: Booklo
description: Product-first soft — one warm off-white world for the landing, auth, admin and booking pages
colors:
  ground: "#fbfbfa"
  ink: "#1c1c1a"
  card: "#ffffff"
  panel: "#f4f4f2"
  panel-hover: "#efefec"
  sidebar: "#f6f6f4"
  text-secondary: "#5f5f5b"
  text-subtle: "#737370"
  hairline: "rgb(28 28 26 / 0.08)"
  hairline-strong: "rgb(28 28 26 / 0.12)"
  kind-time: "#1e8bff"
  kind-time-soft: "#e7f1ff"
  kind-time-text: "#0b6fd6"
  kind-space: "#22b455"
  kind-space-soft: "#e6f7ec"
  kind-space-text: "#15803d"
  kind-class: "#ff3d8f"
  kind-class-soft: "#ffe6f0"
  kind-class-text: "#c81e6a"
  kind-stay: "#ff9500"
  kind-stay-soft: "#fff2df"
  kind-stay-text: "#b45309"
  kind-embed: "#8b5cf6"
  success: "#22b455"
  danger: "#e11d48"
  danger-soft: "#fde7ef"
  night-ground: "#131312"
  night-card: "#1b1b1a"
  night-panel: "#222220"
  night-ink: "#f4f4f2"
  night-hairline: "rgb(244 244 242 / 0.09)"
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

Booklo is drawn as one **product-first soft** world everywhere: the marketing
landing, auth, the admin app and the hosted booking pages share a single
palette declared on `:root` in `src/app/globals.css` (the `.marketing` block
holds the same values plus landing-only notes). Warm off-white ground, white
cards on low-alpha hairlines, near-black ink as the only control colour.
Colour appears **only where it names a kind of booking** — appointments blue,
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
- Kind colours as text always use the `-text` variants (AA on ground and
  tints). Soft tints are for dots, discs, bars and event surfaces.
- Secondary text is `text-muted-foreground` (#5f5f5b); captions and tick
  labels are `text-subtle` (#737370). Never lighter greys for readable text.

## Typography

- **Inter for everything that is read**: headlines at weight 500 with tight
  tracking, body at 400, UI labels at 13px/500.
- **Outfit Semibold only for the "booklo" wordmark** (`BookloWordmark`).
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
- Public booking pages: `px-6 pt-10 pb-8` column, width from
  `pageContainerClass`.

## Elevation & Depth

Two shadows only, defined as tokens and used via `shadow-(--shadow-card)` /
`shadow-(--shadow-lift)`:

- `--shadow-card`: `0 1px 2px rgb(28 28 26 / 0.04), 0 16px 40px -20px rgb(28 28 26 / 0.18)` — overlays (dialogs, popovers, menus, sheets).
- `--shadow-lift`: `0 1px 2px rgb(28 28 26 / 0.05), 0 6px 16px -8px rgb(28 28 26 / 0.14)` — small lifted elements (active nav row, segmented pill, search pill).

Overlay scrims are a plain ink dim (`bg-foreground/10`), no backdrop blur.

## Shapes

The shape rule, everywhere: **pills for controls** (buttons, segmented
switches, search), **10–14px for fragments** (inputs 10px, cards/menus 14px),
**18px+ for panels** (dialogs, auth card). Checkboxes/switches keep their
small radii. Inside button/input groups, pills square off to the group's
radius.

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
- **Overlays**: `rounded-2xl` dialogs, `rounded-xl` popovers/menus, 150ms
  `ease-strong` enter/exit from 95% scale.

## Do's and Don'ts

- Do use `--ease-strong` (`cubic-bezier(0.23, 1, 0.32, 1)`) for state
  transitions; on-screen movement takes `--ease-in-out-strong`.
- Do keep admin motion at 150–250ms, state-driven, transform/opacity only;
  every loop or entrance needs a reduced-motion variant.
- Don't add page-load choreography to admin surfaces.
- Don't put kind colours in chrome, nav, or buttons; ink is the only control
  colour.
- Don't hand grey borders, `transition-all`, pure `#000`/`#fff`, or a second
  accent into any surface.
- Don't render marketing surfaces with `dark:` utilities — the `.marketing`
  scope is light-only by design.
