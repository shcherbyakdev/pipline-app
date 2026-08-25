# Landing redesign — paper, ink, cobalt (2026-08-25)

**Goal (user):** make the landing read at the level of https://www.plain.com/ and
https://calendly.com/ — modern, minimal, clean — with our own design decisions. The hero's
structure (two-line headline → claim bar → live-mirrored mockup) was already right and stays.

**Branch:** `worktree-landing-redesign` (worktree `.claude/worktrees/landing-redesign`).
Supersedes the visual layer of `2026-08-23-landing-claim-design.md`; the claim-bar behaviour,
onboarding hand-off and copy guards in that spec are unchanged.

## What the references actually do

Both pages share four moves; the palette differs.

| | Plain | Calendly |
|---|---|---|
| Ground | white | warm off-white `#FCFBF8` |
| Text | forest ink `#0A2414` | navy `#071A31` |
| Accent | green `#1AD379`, headline line 1 | blue, used sparingly |
| Type | ABC Favorit 400, 80px, tight | Calendly Sans 500, 72px, −2px |
| Labels | Geist Mono uppercase | small caps sparingly |
| Product | tinted rounded panel holding a screenshot, title/body **outside** the panel | pastel gradient panel holding a mock |
| Buttons | mono uppercase, small radius | pills, navy fill |
| Ending | dark band + CTA | navy footer with a statement |

## Our decisions

- **Palette** (`.marketing` in `globals.css`): paper ground `oklch(0.987 0.004 90)`, ink navy
  `oklch(0.22 0.03 262)`, sand `oklch(0.965 0.006 85)` for feature panels, one accent — cobalt
  `oklch(0.53 0.23 268)` (`--highlight`) — and a pale tint of it `oklch(0.955 0.025 268)`
  (`--tint`, new token, mapped as `--color-tint`) for the stage panels behind product UI.
  Cobalt sits a few degrees bluer than the indigo `create_org` seeds as the first staff colour
  (#4f46e5), so a fresh booking page still reads as the same family as the mockups.
- **`.ink` scope** (`.marketing .ink`): ground/text/hairline tokens flipped for the final CTA +
  footer slab. `--card` / `--primary` are left alone so the claim bar stays a white bar with an
  ink button; the bar's label/input use `text-card-foreground` for that reason.
- **Type:** Instrument Sans (variable, Google) for everything, weight 500 for headings with
  `tracking-[-0.035em]`; Geist Mono for eyebrows, step numerals, the URL in the bar. Switzer and
  its self-hosted files are removed (Fragment Mono too).
- **Hero:** line 2 of the headline set in cobalt (Plain's two-tone, inverted to put the accent
  on the promise); the mockup sits in a rounded tint panel that clips it; a dotted cobalt line
  runs from the claim bar into the panel — the name you type becomes the page below. The
  bar's status line shows the "Free during early access" note while idle and the format hint
  once focused/typing (`idleNote` prop), so there is one line under the bar, not two.
- **How it works:** eyebrow + two-column header, three white cards on one dotted line (the
  line only shows in the gaps, so the numbers read as a sequence — they are one).
- **Features (new section, `#features` in the nav):** six sand panels, each holding a
  live-coded fragment (`mocks/feature-mocks.tsx`: page, embed, slot guard, manage, reminder,
  brand); title and body outside the panel. No icons — the fragment is the illustration.
  `Feature.icon` → `Feature.visual`.
- **Your week:** the 3D week calendar inside a tint panel with no right padding, so the grid
  (open on its right edge by design) runs off the panel.
- **FAQ:** eyebrow, hairline list, `+` that rotates to `×`.
- **Final CTA + footer:** one ink slab with a rounded top; the page ends on the claim it opened
  with.
- **Nav:** sticky, blurred; outlined "Log in" + ink "Get started" pills; "Features" link added.

## Removed

`feature-grid.tsx` (icon cards), `embed-showcase.tsx`, `mocks/calendar-mock.tsx`,
`mocks/embed-snippet-mock.tsx`, `SECTIONS.embed`, `FeatureIcon`, `src/features/marketing/fonts/`.

## Not done / deliberately left

- No logos, testimonials or numbers — none are real yet (site.test.ts still forbids unshipped
  features).
- No scroll-reveal motion beyond the hero's entrance; the hero calendar loop is the page's motion.
- 375–390px: the headline wraps to three lines (accepted in the previous spec too).
