# Landing redesign — paper, ink, cobalt (2026-08-25)

**Goal (user):** make the landing read at the level of https://www.plain.com/,
https://calendly.com/ and (added mid-way) https://visitors.now/ — modern, minimal, clean — with
our own design decisions; not "veeery simple"; only informative, needed sections; and reflect
that the widget books **spaces** (rooms, studios, gear by the hour/night) as well as
appointments. The hero's structure (two-line headline → claim bar → live-mirrored mockup) was
already right and stays.

**Branch:** `worktree-landing-redesign` (worktree `.claude/worktrees/landing-redesign`).
Supersedes the visual layer of `2026-08-23-landing-claim-design.md`; the claim-bar behaviour,
onboarding hand-off and copy guards in that spec are unchanged.

## What the references actually do

| | Plain | Calendly | visitors.now |
|---|---|---|---|
| Ground | white | warm off-white `#FCFBF8` | white |
| Text | forest ink `#0A2414` | navy `#071A31` | `#181925` |
| Accent | green, headline line 1 | blue, sparingly | lavender `#918DF6` + pastel gradients |
| Type | ABC Favorit 400, 80px | Calendly Sans 500, 72px, −2px | Open Runde 600, 60px, −3px |
| Labels | Geist Mono uppercase | small caps | badge pills |
| Product | tinted rounded panel + screenshot, copy **outside** | pastel gradient panel + mock | **tab pill on the panel's top edge** switching views |
| Ending | dark band + CTA | navy footer statement | CTA + footer with big mark |

Shared moves: light warm ground, one saturated accent, tinted panels holding *real* UI with
copy outside, mono/badge labels, announcement strip, a dark ending. What made ours read as
"simple" after pass 1: one element per viewport, flat panels, empty step cards, no satellites.

## Sections (final) and why each is there

1. **Announcement strip** — early-access / no card; both references open with one.
2. **Hero** — headline (line 2 cobalt), claim bar (idle note ↔ format hint), dotted connector
   down to a **tab pill (Appointments / Spaces)** on the stage's top edge that flips the mockup;
   textured tint stage (cobalt + warm glow, dot grid); two floating satellites (New booking,
   Reminder scheduled). The mockup itself was rebuilt: minimal chrome (three quiet dots + the
   address pill the claim bar mirrors into), provider header, Services *or* Spaces list with
   blurbs and mono meta (`by the hour · 1–4 h`, `per night · min 2 nights`), circular day
   picker, then a slot with a split "10:30 | Confirm" pill or an hourly window strip.
3. **Who it's for** — sand band: heading + wrap of audience pills (consultants … courts, gear
   rental) + the three things the page removes.
4. **How it works** — three cards on one dotted line, each with a fragment in a sand header.
5. **Features** — 7 items in a 6-column bento (4/2, 2/4, 2/2/2): hosted page (desktop + phone),
   spaces (room card + hour strip), slot guard, manage (email + reschedule), embed, reminder,
   brand. Sand panels with a faint cobalt glow, copy outside.
6. **FAQ** — incl. "Can I rent out a room, a studio or gear?".
7. **Claim your page** (ink slab) + footer.

**Removed on the user's call:** the "Your week" admin-calendar section and its 3D
`hero-calendar` mock (in git history at `470120f` if ever wanted back) — the admin view isn't
needed to understand what a client gets.

## Tokens, type, motion

- `.marketing`: paper `oklch(0.987 0.004 90)`, ink `oklch(0.22 0.03 262)`, sand
  `oklch(0.965 0.006 85)`, cobalt `--highlight oklch(0.53 0.23 268)`, `--tint
  oklch(0.955 0.025 268)` (`--color-tint`). `.marketing .ink` flips ground/text/hairlines for
  the CTA + footer; `--card` / `--primary` untouched so the claim bar stays a white bar with
  an ink button (its label/input use `text-card-foreground`).
- Instrument Sans (500 headings, `tracking-[-0.035em]`) + Geist Mono, via `next/font/google`;
  Switzer files removed.
- Motion: hero entrance (existing), `.animate-float` satellites, `Reveal` scroll fade-ups
  (`components/reveal.tsx`, IntersectionObserver → `data-in`, no state; `.reveal` in
  globals.css; `<noscript>` in the layout; all off under reduced motion).

## Vocabulary

Spaces copy uses `SPACES` from `features/orgs/vocab.ts` (tab label = `SPACES.pickerTitle`,
list heading = `SPACES.widgetGroup`) and the product's phrasing "by the hour, night or day",
"units". Nothing about prices, deposits or payments (still forbidden copy).

## Not done / deliberately left

- No logos, testimonials or numbers — none are real yet.
- 375–390px: the headline wraps to three lines (accepted before).
- The satellites are decorative fixtures, not live data.
