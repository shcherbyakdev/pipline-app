# App Shell & Design System — Design

**Date:** 2026-08-07
**Status:** Approved (direction + scope). Precedes Feature #2 (Templates).

## Goal

Reskin the bare authed shell into a **Linear-inspired** operator UI — a dark-first design-token system, a sidebar app shell, a `Cmd-K` command palette, and the low-cost "feels instant" primitives — so every later feature (Templates, Rollouts, Matrix) is built inside a consistent, fast-feeling frame.

**Chosen direction (from brainstorm):** Linear look & feel + cheap speed. NOT a local-first sync engine — we keep the server-centric Next.js + Supabase RLS foundation and layer optimistic UI, TanStack Query, and (later) Realtime on top.

## Visual language

Linear-*inspired*, own identity — dark-first, flat, near-monochrome + one accent.

- **Theming via CSS variables** (Tailwind v4 `@theme` + Base UI already work this way). All color/space/radius are tokens — never hard-coded — so the white-label portal can override brand tokens per-org later. This slice only *structures* tokens for that; it does not build portal theming.
- **Default dark, full light support.** `next-themes` for toggle + persistence (class strategy, `suppressHydrationWarning` already on `<body>`). Internal app defaults dark; client portal (future) defaults light.
- **Flat surfaces, hairline borders, no drop shadows.** Layered near-black backgrounds (base → elevated), 1px low-contrast borders, small radii (~6–8px), tight spacing scale.
- **Accent: teal** — the brand/primary/focus color. Deliberately not Linear's indigo, and deliberately *outside* the status spectrum so it never collides with status meaning. Single source token; swappable.
- **Typography: Inter** (via `next/font/google`, variable) for sans; keep a monospace for IDs/code. Tight tracking (~-0.01em) on headings; compact type scale.
- **Status semantic palette** (distinct from the brand accent) — one token set + a `StatusBadge` component:
  - `not-started` (gray) · `in-progress` (blue) · `complete` (green) · `at-risk` (amber) · `blocked` (red)

Exact hex values, contrast tuning, and spacing are finalized during implementation (frontend-design skill); this spec fixes the *system*, not the swatches.

## App shell (Linear layout)

Replaces the current `(dashboard)/layout.tsx` header with a two-region shell:

- **Left sidebar** (collapsible): org name at top (switcher-ready affordance, no switching yet) · primary nav — **Rollouts**, **Templates** (room reserved for Inbox/Blockers/Settings later) · user identity + **sign-out** pinned at the bottom.
- **Main region**: a thin **top bar** (contextual view title / breadcrumb + view-level actions slot) above the routed content.
- **Responsive**: sidebar collapses to an off-canvas drawer on small screens; a trigger lives in the top bar.
- Active-route highlighting uses the accent token.

The shell is a client-islands-in-server-layout composition: the layout stays a Server Component that calls `requireOrg()` (unchanged auth boundary); interactive pieces (sidebar collapse, theme toggle, command palette) are Client Components.

## Interaction — "feels instant" primitives

- **Command palette (`Cmd-K`)** via `cmdk` (shadcn `Command` in a dialog). Real commands from day one: navigate to Rollouts/Templates, "Create rollout"/"Create template" (route to the future create flows), toggle theme. Structured so features register their own commands later.
- **Keyboard shortcuts**: seed a minimal registry (`Cmd-K` to open palette, `?` for a shortcuts hint). Not an app-wide map yet.
- **Optimistic UI convention**: document + establish the `useOptimistic` + Server Action pattern (a small example wired into an existing action, e.g. sign-out/theme). Applied per-feature as mutations arrive.
- **TanStack Query provider**: `QueryClientProvider` at the app root (client boundary) for client-side caching/prefetch where features need it. SSR-friendly defaults.
- **Toasts**: `sonner` `<Toaster />` mounted in the shell; a `toast` convention for action feedback.

## Component set

Add shadcn/Base UI components as the shell needs them: `command`, `dialog`, `dropdown-menu`, `tooltip`, `avatar`, `badge`, `separator`, `skeleton`, `sonner`. Plus project components: `StatusBadge` (semantic status), `ThemeToggle`, `AppSidebar`, `CommandMenu`, `TopBar`. Reuse existing `button`, `input`, `label`.

## Integration with the existing foundation

- No change to auth/tenancy/RLS. The `(dashboard)` layout keeps `requireOrg()`; the shell renders around it.
- `/rollouts` and `/templates` become the first two nav destinations (stub pages already exist / are trivial).
- Providers (`ThemeProvider`, `QueryClientProvider`, `Toaster`, `CommandMenu`) wrap the authed app via a client provider component mounted in the dashboard layout (not the root layout — the public landing/login stay minimal).

## Scope

**In:** token system + theming (dark/light, teal accent, Inter, status palette) · sidebar + top-bar shell · command palette (with real nav/theme commands) · TanStack Query provider · sonner toasts · optimistic-UI convention seeded · `StatusBadge` + base components.

**Out (deliberate):** Supabase **Realtime** (arrives with the progress matrix) · full app-wide keyboard-shortcut map (seed only) · the portal's actual per-org runtime theming (only structure tokens) · any Templates/Rollouts domain content (Feature #2+) · org switching / multi-org.

## New libraries

`next-themes`, `cmdk`, `sonner`, Inter (`next/font/google`). `@tanstack/react-query` already installed. Icons via `lucide-react` (already present through shadcn).

## Open items before implementation

1. Confirm final accent hex + neutral ramp during build (frontend-design skill).
2. Decide sidebar default state (expanded on desktop, collapsed on mobile) — default expanded.
