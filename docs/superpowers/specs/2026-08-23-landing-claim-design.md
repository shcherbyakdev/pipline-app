# Landing redesign + claim-your-page onboarding — design

**Date:** 2026-08-23 · **Branch:** `feat/landing-claim` · **Status:** approved in chat, ready for planning

## 1. Goal

Replace the Linear-dark landing with a minimal, light page whose single call to
action is *claim your handle*: type `booklo.co/anna`, hit **Claim**, sign up,
and arrive in the app with the page already named and addressed. Three things
ship together because each is hollow without the others:

1. A new landing page (light, centred hero, claim bar, live-mirrored booking-page mockup).
2. The claim flow: public availability check → `/signup?handle=` → handle stored on the auth user → one-step onboarding that creates the org *with* its handle and timezone.
3. Root short links: the public page answers at `booklo.co/anna` (with `/book/anna` as a permanent redirect), so the promise in the input is literal.

Out of scope (see §9): handle reservations/TTL, rate-limiting the check, a first-run checklist, OG image, renaming anything under `/book/` internally.

## 2. Decisions (with the alternatives rejected)

| # | Decision | Rejected |
|---|----------|----------|
| D1 | Landing flips to **light**; only the `.marketing` token block changes. Admin app stays `.dark`. | Keep dark; light hero over dark sections. |
| D2 | **No third-party runtime assets.** Switzer (self-hosted) stays as the sans; the reference's photo + grass PNG are replaced by a flat off-white ground with a faint accent wash under the mockup. | Hot-link `onlinewebfonts` / `higgs.ai` / Cloudinary URLs; download and self-host them. |
| D3 | Claim **checks availability, then carries the handle** to signup. No reservation. | Carry without checking; 15-minute reservation table. |
| D4 | The handle survives signup → email confirm → onboarding as **Supabase user metadata** (`user_metadata.claimed_handle`). Bound to the account, works cross-device. | URL param through the confirm link; cookie. |
| D5 | Onboarding becomes **one step**: name + handle + timezone → one RPC. | Three-step wizard; keep name-only onboarding and pre-fill `/booking-page` later. |
| D6 | Page = hero + **How it works** + **FAQ** + **final CTA** (claim bar again) + footer. Feature grid, product showcase, embed showcase, 3D hero calendar are removed from the page; their files stay for a later cleanup. | All sections restyled; hero + footer only. |
| D7 | Mockup under the hero = **the public booking page**, in light browser chrome, whose URL bar and title mirror the claim input live. | Reuse the 3D admin calendar; port the reference's dark dashboard. |
| D8 | **Root short links** `/:handle` and `/:handle/:staffSlug`, with `/book/…` → 308. Reserved-word list keeps handles from shadowing app routes. | Show `booklo.co/book/` in the input. |
| D9 | The public page keeps **404-ing while the org has no services** (`src/app/book/[handle]/page.tsx`, the `services.length === 0 && offerings.length === 0` guard). Post-onboarding copy therefore says *reserved — add a service to go live*, not *live*. | Render an "not taking bookings yet" placeholder (a privacy regression: it would confirm which handles exist before the owner publishes anything). |

## 3. Landing page

### 3.1 Structure

`src/app/(marketing)/page.tsx` renders, in order: `MarketingNav`, `Hero`, `HowItWorks`, `Faq`, `FinalCta`, `MarketingFooter`. The `(marketing)/layout.tsx` wrapper, its Switzer/Fragment Mono font setup and the `.marketing` scoping stay as they are; only the tokens inside `.marketing` change.

### 3.2 Tokens (`src/app/globals.css`, `.marketing` block)

`color-scheme: light`. Ground `#fafafa` (`--background`), type `#111111` (`--foreground`), cards white, borders `rgb(0 0 0 / 8%)`, muted text `#6b7280` (gray-500, 4.6:1 on the ground — AA for body), secondary text `#374151` (gray-700). **One accent:** indigo `#4f46e5` — the same value `create_org` seeds as the first staff colour (`0041_staff_security.sql`), so the landing and a fresh booking page agree. `--primary` is the near-black button (`#111111`, white text). The indigo is a **new token `--highlight`** (mapped as `--color-highlight` in `@theme`, defined for `.marketing` only), used solely for the headline highlight, focus rings, the mockup's selected day, and the wash under the mockup (`oklch` of the indigo at 8% alpha, radial, bottom-centred). `--accent` keeps its shadcn meaning (subtle hover surface, `rgb(0 0 0 / 4%)`) so shared components behave.

Landing components use tokens only, never `dark:` utilities (unchanged rule from the previous landing spec).

### 3.3 Navbar (`marketing-nav.tsx`)

- `relative z-20`, `animate-fade-down`; `px-5 sm:px-8 lg:px-10`, `py-4 sm:py-5`.
- Left: `BookloMark` + wordmark, `text-foreground`. Centre (hidden below `md`): `NAV_LINKS` (`How it works`, `FAQ`, `Pricing` when `FLAG_DEFAULTS.billing`), `text-[13px]`, gap 8. Right: `Log in` (quiet) + **Get started** (`bg-primary text-primary-foreground text-[13px] font-medium px-4 sm:px-5 py-2 rounded-full`), then the hamburger (`md:hidden`, `size-9 rounded-full`, `Menu`/`X`).
- Mobile dropdown: `absolute left-4 right-4 top-full rounded-2xl bg-white/80 backdrop-blur-xl ring-1 ring-border px-5 py-3 animate-fade-up`, links `text-[15px]` separated by `border-b`, last without. Closes on link click and on `Escape`; the button carries `aria-expanded` and `aria-controls`.

### 3.4 Hero (`hero.tsx`, client component)

Section: `relative min-h-[100svh] overflow-hidden flex flex-col bg-background`. Owns `handle` state and passes it to `ClaimBar` and `BookingPageMock`.

- Spacer `flex-1 min-h-8 sm:min-h-12 lg:min-h-16 shrink-0`.
- `h1` — `font-normal leading-[1.05] tracking-tight text-foreground text-[40px] min-[400px]:text-[44px] sm:text-6xl lg:text-7xl xl:text-[80px]`, two `block` lines with `animate-fade-up`, second at `[animation-delay:100ms]`. Copy from `SITE.headline: [string, string]` — draft **"Your booking page."** / **"Claimed in a minute."**; the second line's last word wears the accent highlight (skewed `bg-highlight/30` behind the text, CLNDR-style). The `sr-only` full sentence is the accessible name (`id="hero-heading"`, `aria-labelledby`).
- Sub-line — `animate-fade-up [animation-delay:220ms] mt-4 sm:mt-5 text-foreground/75 text-sm sm:text-base lg:text-lg max-w-md`. Draft: *"Clients pick a time, you both get the email. No accounts, no double bookings."*
- **Claim bar** (§3.5) — `animate-fade-up [animation-delay:340ms] mt-5 sm:mt-6 w-full max-w-xl`.
- Note line — `animate-fade-up [animation-delay:460ms] text-muted-foreground text-sm` — `SITE.heroNote` (flag-conditional, unchanged).
- Spacer `flex-1 min-h-10 sm:min-h-12 lg:min-h-16 shrink-0`.
- **Mockup** (§3.6) — `animate-hero-rise [animation-delay:620ms] relative z-0 w-[92%] sm:w-[84%] lg:w-[72%] max-w-4xl mx-auto shrink-0 -mb-10 sm:-mb-20 lg:-mb-32`.

The wash: an absolutely positioned `pointer-events-none` div at the bottom of the section, `h-[45%]`, radial gradient in `--highlight`, behind the mockup (`z-0`, mockup `z-[1]`).

### 3.5 Claim bar (`claim-bar.tsx`, client)

Reused by `Hero` and `FinalCta`. Props: `{ handle, onHandleChange, size?: "lg" | "md", autoFocus? }`.

- Form, `onSubmit` → `checkHandle` server action (§4.1). Pill: `flex items-center gap-2 rounded-full bg-white ring-1 ring-border pl-5 pr-1.5 py-1.5 shadow-sm focus-within:ring-2 focus-within:ring-highlight`.
- Prefix `booklo.co/` in `font-mono text-foreground` (from `SITE.claimPrefix`, derived from `NEXT_PUBLIC_APP_URL`'s host so dev shows `localhost:3000/`). Input `flex-1 bg-transparent text-sm sm:text-base outline-none py-2`, placeholder `your-name`, `autocomplete="off"`, `spellcheck=false`, `inputmode="url"`, `aria-label="Your page name"`, `aria-describedby` → the status line. Every keystroke runs `normalizeHandle` (§4.3) so the field only ever shows a legal prefix of a handle.
- Button: `size-9 sm:size-10 rounded-full bg-primary text-primary-foreground hover:scale-105 active:scale-95 transition-transform motion-reduce:transition-none shrink-0`, `ArrowRight` icon, `aria-label="Claim"`; a spinner (`Loader2` + `animate-spin`) while pending; disabled when the handle is shorter than 3 characters.
- Status line (`aria-live="polite"`, `min-h-5 mt-2 text-sm`): idle → `SITE.claim.hint` (*"3–50 characters: letters, numbers, dashes."*); taken → *"booklo.co/anna is taken — try **anna-studio**"* where the suggestion is a button that replaces the input; free → navigates (no message); check failed → *"Couldn't check right now — continue anyway"* with the button still navigating; reserved/invalid → the hint in `text-destructive`.
- Free → `router.push(`/signup?handle=${handle}`)`.

### 3.6 Mockup (`browser-frame.tsx`, `mocks/booking-page-mock.tsx`)

- `ScaledFrame`: renders children at a fixed design width (896px) inside a `ResizeObserver`-measured container; applies `transform: scale(w/896)` with `transformOrigin: top left` and sets the outer height to `inner.offsetHeight * scale`. Client component; server-renders at scale 1 and corrects on mount (the `hero-rise` animation hides the jump).
- Chrome: `rounded-t-2xl overflow-hidden bg-white shadow-[0_-20px_80px_rgb(0_0_0/0.12)] ring-1 ring-border text-left`. Title bar `bg-[#f4f4f5] border-b border-border px-4 py-2.5`: traffic lights (`#ff5f57`, `#febc2e`, `#28c840`), `PanelLeft`/`ChevronLeft`/`ChevronRight` at `text-foreground/30`, centred URL pill `bg-white rounded-md px-6 py-1 text-[10px] text-foreground/60` with `Lock` icon reading **`booklo.co/{handle || "your-name"}`**, right icons `RotateCw`, `Share`, `Plus`, `Copy`.
- Body (static, no interactivity; `aria-hidden`, wrapped in a `figure` with a visually hidden caption *"Preview of a Booklo booking page"*): a two-column layout at 896 — left card: avatar circle, title **`toDisplayName(handle) || "Your Name"`** (`text-lg font-medium`), line *"Book a session"*, two service rows (*Consultation · 30 min*, *Follow-up · 15 min*) with the first selected; right: month header with chevrons, weekday row, a 5-week grid where ~12 days are bookable (white cells with `ring-1`), one selected in the highlight colour, and a slot column of five times with one selected. All copy is fixtures in the component, not `site.ts`, and obeys `FORBIDDEN_COPY`.

### 3.7 Sections below the hero

- **How it works** (`how-it-works.tsx`): `SECTIONS.how.heading`, three rows from `STEPS` — numeral in mono highlight colour, title, one-line body. `STEPS` bodies are shortened to one sentence each (copy change in `site.ts`).
- **FAQ** (`faq.tsx`): existing `FAQ` data and accordion, light tokens; no structural change.
- **Final CTA** (`final-cta.tsx`): heading *"Claim your page."*, the `ClaimBar` (`size="md"`, its own local handle state), `SITE.heroNote`.
- **Footer**: unchanged apart from tokens.

### 3.8 Motion

Keyframes move from `hero-reveal.module.css` (deleted) into `globals.css`:

```css
@keyframes fade-up   { from { opacity:0; transform:translateY(24px); filter:blur(6px) } to { opacity:1; transform:none; filter:blur(0) } }
@keyframes fade-down { from { opacity:0; transform:translateY(-16px) } to { opacity:1; transform:none } }
@keyframes hero-rise { from { opacity:0; transform:translateY(64px) scale(.97) } to { opacity:1; transform:none } }
.animate-fade-up   { animation: fade-up .9s cubic-bezier(.22,1,.36,1) both }
.animate-fade-down { animation: fade-down .7s cubic-bezier(.22,1,.36,1) both }
.animate-hero-rise { animation: hero-rise 1.1s cubic-bezier(.22,1,.36,1) both }
@media (prefers-reduced-motion: reduce) { .animate-fade-up, .animate-fade-down, .animate-hero-rise { animation: none } }
```

Delays are Tailwind arbitrary values (`[animation-delay:220ms]`).

### 3.9 Responsive summary

| Element | <640 | sm | md | lg | xl |
|---|---|---|---|---|---|
| Headline | 40px (44 ≥400px) | 60px | — | 72px | 80px |
| Nav links | hamburger | — | visible | — | — |
| Claim bar | full width | — | — | — | `max-w-xl` |
| Mockup width | 92% | 84% | — | 72% | — |
| Mockup overlap | `-mb-10` | `-mb-20` | — | `-mb-32` | — |

## 4. Claim flow

### 4.1 Availability check

**SQL** (`src/db/migrations/0047_handles.sql`):

```sql
create or replace function public.reserved_handles() returns text[]
language sql immutable set search_path = '' as $$
  select array['api','auth','availability','billing','book','booking','booking-page','bookings',
    'clients','dev','embed','forgot-password','login','onboarding','overview','p','portal','pricing',
    'privacy','programs','rentals','reset-password','services','settings','signup','team','templates',
    'terms','utils',                                   -- every top-level app route today
    'admin','app','www','mail','help','support','docs','blog','about','contact','status','static',
    'assets','public','booklo','me','new','home','index','sitemap','robots','favicon']
    -- generic names. `_next` and `embed.js` are omitted: neither can match HANDLE_RE.
$$;

create or replace function public.is_handle_available(p_handle text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_handle ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'
     and not (p_handle = any (public.reserved_handles()))
     and not exists (select 1 from public.orgs where handle = p_handle)
$$;
revoke all on function public.is_handle_available(text) from public;
grant execute on function public.is_handle_available(text) to anon, authenticated;
```

`update_org_scheduling` is re-created with the same reserved check added after the format check (body otherwise verbatim from `0026_scheduling_security.sql`). A migration-side check constraint is deliberately **not** added: existing rows are unaffected and the RPCs are the only write paths.

**Server action** `checkHandle(handle: unknown): Promise<{ status: "free" | "taken" | "invalid" | "error"; suggestion?: string }>` in `src/features/scheduling/handle-actions.ts` — no session required. Parses with `z.string().regex(HANDLE_RE)`; reserved → `invalid`; calls the RPC; on `taken`, tries `suggestHandle(handle)` candidates in order until one is free (max 3 RPC calls) and returns the first. Any RPC error → `error` (logged server-side).

### 4.2 `/signup?handle=anna`

- `src/app/(auth)/signup/page.tsx` reads `searchParams.handle`, keeps it only if `HANDLE_RE` matches and it is not reserved; otherwise renders the plain form. With a handle: a line above the form in mono, *"Claiming booklo.co/anna"*, and a hidden input `name="handle"`.
- `signUp` (`src/features/auth/actions.ts`) parses `handle` as optional (`signUpSchema` gains `handle: z.string().regex(HANDLE_RE).optional()`, `""` → undefined) and passes `options.data = { claimed_handle }` when present. The sent-state copy becomes *"Check your email to confirm your account and claim booklo.co/anna."* when a handle is present.
- Metadata is advisory: it only pre-fills onboarding. `createOrgWithPage` re-validates everything.

### 4.3 Handle helpers (`src/features/scheduling/schema.ts`)

- `RESERVED_HANDLES: readonly string[]` — the same list as `reserved_handles()`. `schema.test.ts` reads `0047_handles.sql`, extracts the array literal, and asserts set equality, so the two can never drift.
- `isReservedHandle(h)`.
- `normalizeHandle(raw)`: lowercase, spaces/underscores → `-`, strip everything outside `[a-z0-9-]`, collapse runs of `-`, strip a leading `-`, cap at 50. Keeps a trailing `-` while typing (the regex rejects it on submit; the hint explains).
- `toDisplayName(handle)`: `anna-studio` → `Anna Studio`.
- `suggestHandle(handle)`: `[`${h}-studio`, `${h}-booking`, `${h}-2`, `${h}-3`]`, each re-normalised and capped.

### 4.4 Onboarding (`src/app/onboarding/`)

Page (`requireUser`, redirects to `/bookings` if an org exists — unchanged) renders heading **"Claim your page"**, sub *"This is the address clients book you at. You can change it later."*, and `OnboardingForm` with `initialHandle = user.user_metadata.claimed_handle` (validated server-side; invalid/reserved → `null`).

Form fields:
- **Name** — `Input`, required, 2–80 chars (existing `createOrgSchema` rule), default `toDisplayName(initialHandle)`.
- **Handle** — the same pill as the landing (prefix + input), default `initialHandle`, optional (an empty handle creates the org without one, exactly as today). Debounced (400 ms) `checkHandle` drives the status line; the submit button is never blocked by the check — the RPC is the guard.
- **Timezone** — `select` over `Intl.supportedValuesOf("timeZone")` (as in `scheduling-settings-form.tsx`), default from `Intl.DateTimeFormat().resolvedOptions().timeZone`, with a hidden fallback of `UTC` for SSR.

Submit → `createOrgWithPage(formData)` (`src/features/orgs/actions.ts`): parses `{ name, handle?, timezone }`, calls RPC **`create_org_with_page(p_name, p_handle, p_timezone)`** (new, in `0047`): identical body to `create_org` from `0041_staff_security.sql`, then `update public.orgs set handle = p_handle, timezone = p_timezone where id = v_org.id` inside the same function (one transaction), after the same format/reserved/timezone checks `update_org_scheduling` performs. `23505` → `{ error: "That name was just taken — pick another." }` and the form keeps all values; other errors → `GENERIC_WRITE_ERROR`. Success → `redirect("/bookings?welcome=1")`. `create_org(text)` stays (tests, seeds, any caller that has no handle).

### 4.5 Welcome banner (`/bookings`)

`src/app/(dashboard)/bookings/page.tsx` reads `searchParams.welcome`; when `"1"` and the org has a handle, it renders a dismissible banner above the list: **"booklo.co/anna is yours."** *"Add your first service to go live."* — **Add a service** (→ `/services`), **Copy link** (copies `bookingUrl(handle)`). No handle → *"Your workspace is ready."* with **Set up your booking page** (→ `/booking-page`). Dismiss = `router.replace("/bookings")`; nothing is persisted.

## 5. Root short links

- `src/app/[handle]/page.tsx` and `src/app/[handle]/[staffSlug]/page.tsx`: `export { default } from "@/app/book/[handle]/page"` (and the staff variant; neither page defines `generateMetadata` today — if one is added later it must be re-exported too). `src/app/[handle]/layout.tsx` re-exports `src/app/book/layout.tsx`. Next's static routes take precedence over the dynamic segment, so every existing route keeps working; the reserved list ensures no org can hold a handle that a static route would shadow.
- `src/app/book/[handle]/page.tsx` and `.../[staffSlug]/page.tsx` become `permanentRedirect("/" + handle[ + "/" + staffSlug])`. The `book/layout.tsx` stays (the root layout imports it).
- `bookingUrl(handle, staffSlug?)` in `src/lib/booking/url.ts` → `${env.NEXT_PUBLIC_APP_URL}/${handle}`; `bookingPath(handle, staffSlug?)` for relative use. Callers updated: `scheduling-settings-form.tsx:55`, `booking-page-studio.tsx:70`, `staff-list.tsx:39`, `org-picker.tsx:40`, and every email template or test helper that builds `/book/` (grep `"/book/`, `` `/book/ ``). `embed.js` / `/embed/[handle]` are untouched.
- A unit test asserts no `"/book/` literal remains outside `src/app/book/**` and tests.

## 6. Copy (`site.ts`)

New/changed keys: `headline: [string, string]`, `subheadline`, `claim: { prefix, placeholder, hint, taken(handle, suggestion), unavailable, checkFailed }`, `onboarding: { heading, sub, nameLabel, handleLabel, timezoneLabel, submit, submitting, justTaken }`, `welcome: { owned(url), addService, copyLink, noHandle, setUpPage }`, `finalCta: { heading }`, trimmed `STEPS` bodies, `SECTIONS.how.sub`. Onboarding and welcome copy live in `site.ts` too (plain data with tests), even though those screens render inside the app. `FORBIDDEN_COPY` unchanged and still enforced by `site.test.ts`; the test also walks the new keys.

## 7. Migrations

`0047_handles.sql` — `reserved_handles()`, `is_handle_available()`, `update_org_scheduling` (re-created with reserved check), `create_org_with_page()`, grants per `supabase-grants-convention`. **Numbering hazard:** the booking-page-builder spec (not built) also planned 0047/0048; whichever branch merges second renumbers. Drizzle snapshot regenerated (`npm run db:generate` after hand-writing the SQL, per repo convention).

## 8. Testing

- **Unit (Vitest):** `normalizeHandle`, `toDisplayName`, `suggestHandle`, `isReservedHandle`; reserved-list parity with `0047_handles.sql`; `site.test.ts` extended (forbidden words, every href resolves, headline tuple); `bookingUrl`/`bookingPath`; the `/book/` literal guard (§5); `signUpSchema` accepts/omits `handle`.
- **Integration (Supabase harness, `vitest.integration.config.ts`):** `is_handle_available` as `anon` for free / taken / reserved / malformed; `create_org_with_page` happy path sets handle + timezone atomically, duplicate → `23505`, reserved → exception, bad timezone → exception, `p_handle = null` works; `update_org_scheduling` rejects a reserved handle.
- **Manual QA (Playwright MCP in-session, not committed):** hero at 375 / 768 / 1280, reduced-motion on, keyboard-only claim → signup → (Mailpit) confirm → onboarding pre-filled → `/bookings?welcome=1` → `/<handle>` renders once a service exists, `/book/<handle>` 308s.

## 9. Deferred

- Handle reservation with TTL; rate limiting `checkHandle`.
- First-run checklist beyond the welcome banner.
- OG image for the light landing.
- Removing the now-unused `feature-grid`, `product-showcase`, `embed-showcase`, `mocks/hero-calendar*`, `calendar-mock`, `embed-snippet-mock` files.
- Making `/book/**` internals (`getBookingOrg` etc.) route-agnostic in naming.
