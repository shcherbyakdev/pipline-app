# App Shell & Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the bare authed shell into a Linear-inspired operator UI — dark-first design tokens, a sidebar app shell, a `Cmd-K` command palette, and the low-cost "feels instant" primitives — so later features build inside a consistent, fast frame.

**Architecture:** Server Components stay the default; the auth boundary (`requireOrg()` in the `(dashboard)` layout) is untouched. Interactive pieces (theme, sidebar collapse, command palette, query cache, toasts) are Client Components mounted via a single `Providers` island in the dashboard layout. All color/space/radius are CSS-variable tokens so the future white-label portal can re-theme per-org.

**Tech Stack:** Next.js 16 (App Router), React 19, Tailwind v4, Base UI (shadcn), `next-themes`, `cmdk`, `sonner`, `@tanstack/react-query`, Inter via `next/font`, `lucide-react`.

## Global Constraints

- **Next.js 16** — Server Components by default; anything with hooks/state is a Client Component (`"use client"`).
- **Tokens only.** Components must use token-backed utilities (`bg-background`, `text-primary`, `bg-status-blocked/10`, …) — never hard-coded hex/rgb. New tokens go in `globals.css` and are registered in `@theme inline`.
- **Visual identity:** dark default + light support (`next-themes`, `class` strategy); flat surfaces + hairline borders (no drop shadows); small radii; **teal** primary/accent; **Inter** sans. Status palette (distinct from accent): `not-started` gray · `in-progress` blue · `complete` green · `at-risk` amber · `blocked` red.
- **Auth boundary unchanged:** `(dashboard)/layout.tsx` still calls `requireOrg()`; the shell renders around it.
- **Feature-sliced; `@/*` imports.** Shell components live under `src/components/shell/`; shared UI under `src/components/`.
- **Accessibility:** visible focus rings (accent) on interactive elements; the command palette and nav are keyboard-operable.
- **Verification split:** subagents verify with `tsc`/`build`/unit tests + structural grep. **Visual verification (screenshots, theme/appearance) is done by the controller** via the run/browser tooling — the local Supabase stack + a login session are available. Do not force pixel checks into subagent tasks.

---

## Task 1: Design tokens, Inter font, theme provider + toggle

**Files:**
- Modify: `src/app/globals.css` (add teal primary override + status tokens, register in `@theme inline`)
- Modify: `src/app/layout.tsx` (Inter font; default `dark` class on `<html>`)
- Create: `src/components/providers.tsx` (client; ThemeProvider now, extended in Task 4)
- Create: `src/components/theme-toggle.tsx`
- Modify: `src/app/(dashboard)/layout.tsx` (wrap children in `<Providers>`)
- Add deps: `next-themes`; shadcn `dropdown-menu`

**Interfaces:**
- Produces: `Providers` (client wrapper, currently ThemeProvider), `ThemeToggle` (button cycling light/dark).

- [ ] **Step 1: Install deps**

```bash
npm install next-themes
npx shadcn@latest add dropdown-menu -y
```

- [ ] **Step 2: Extend `globals.css` tokens**

First READ `src/app/globals.css` (shadcn already defined base tokens in `:root` and `.dark` plus an `@theme inline` block). Make these edits, preserving everything else:

(a) Override the primary to teal in BOTH `:root` and `.dark`:

```css
/* in :root { ... } — light */
--primary: oklch(0.62 0.12 187);
--primary-foreground: oklch(0.99 0 0);

/* in .dark { ... } — dark */
--primary: oklch(0.70 0.13 185);
--primary-foreground: oklch(0.18 0.03 190);
```

(b) Add the status token block inside BOTH `:root` and `.dark` (same hues work for both; badges render them at low opacity):

```css
--status-not-started: oklch(0.65 0 0);
--status-in-progress: oklch(0.62 0.17 250);
--status-complete: oklch(0.68 0.17 150);
--status-at-risk: oklch(0.78 0.15 75);
--status-blocked: oklch(0.63 0.22 25);
```

(c) Register the status tokens as colors in the existing `@theme inline { ... }` block so utilities like `bg-status-blocked` exist:

```css
--color-status-not-started: var(--status-not-started);
--color-status-in-progress: var(--status-in-progress);
--color-status-complete: var(--status-complete);
--color-status-at-risk: var(--status-at-risk);
--color-status-blocked: var(--status-blocked);
```

- [ ] **Step 3: Switch the font to Inter + default dark**

Replace `src/app/layout.tsx` font wiring. READ it first; then set Inter as sans (keep a mono) and add `dark` as the default class on `<html>` (next-themes will manage it thereafter). Result:

```tsx
import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-sans", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "RolloutOS",
  description: "Turn your rollout spreadsheet into a live operations portal.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable} h-full antialiased`} suppressHydrationWarning>
      <body suppressHydrationWarning className="min-h-full flex flex-col">
        {children}
      </body>
    </html>
  );
}
```

Then ensure `globals.css` maps the font vars (in `@theme inline`): `--font-sans: var(--font-sans);` already resolves; confirm `--font-sans`/`--font-mono` are referenced by the base `body`/`@theme` (shadcn maps `--font-sans`). If shadcn used `--font-geist-sans`, update those references to `--font-sans`/`--font-mono`.

- [ ] **Step 4: Create the Providers island**

`src/components/providers.tsx`:

```tsx
"use client";

import { ThemeProvider } from "next-themes";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
      {children}
    </ThemeProvider>
  );
}
```

- [ ] **Step 5: Create the ThemeToggle**

`src/components/theme-toggle.tsx`:

```tsx
"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      {mounted && resolvedTheme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}
```

- [ ] **Step 6: Mount Providers in the dashboard layout**

In `src/app/(dashboard)/layout.tsx`, wrap the returned tree in `<Providers>` (import from `@/components/providers`). Keep the existing `requireOrg()` call and header for now (the shell replaces the header in Task 3). Add the `<ThemeToggle />` into the existing header so it's testable this task.

- [ ] **Step 7: Verify (subagent) + commit**

```bash
npx tsc --noEmit && npm run build
grep -q "status-blocked" src/app/globals.css && echo "tokens present"
```
Expected: build passes; `/rollouts` still builds; tokens present. Commit:

```bash
git add src/app/globals.css src/app/layout.tsx src/components/providers.tsx src/components/theme-toggle.tsx "src/app/(dashboard)/layout.tsx" src/components/ui/dropdown-menu.tsx package.json package-lock.json
git commit -m "feat(ui): teal token system, Inter font, dark-first theme provider + toggle"
```

**Controller visual checkpoint (not a subagent step):** log in, confirm dark default, teal accents, Inter, and the toggle switching light/dark.

---

## Task 2: Status tokens → StatusBadge (TDD)

**Files:**
- Create: `src/lib/status.ts`
- Create: `src/lib/status.test.ts`
- Create: `src/components/status-badge.tsx`
- Add: shadcn `badge`

**Interfaces:**
- Produces:
  - `type UnitStatus = "not_started" | "in_progress" | "complete" | "at_risk" | "blocked"`
  - `getStatusMeta(status: UnitStatus): { label: string; className: string }`
  - `STATUS_ORDER: UnitStatus[]`
  - `StatusBadge({ status }: { status: UnitStatus })` component

- [ ] **Step 1: Add the badge primitive**

```bash
npx shadcn@latest add badge -y
```

- [ ] **Step 2: Write the failing test**

`src/lib/status.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getStatusMeta, STATUS_ORDER } from "./status";

describe("getStatusMeta", () => {
  it("returns a human label for each status", () => {
    expect(getStatusMeta("not_started").label).toBe("Not started");
    expect(getStatusMeta("in_progress").label).toBe("In progress");
    expect(getStatusMeta("complete").label).toBe("Complete");
    expect(getStatusMeta("at_risk").label).toBe("At risk");
    expect(getStatusMeta("blocked").label).toBe("Blocked");
  });
  it("maps each status to a status-token className", () => {
    expect(getStatusMeta("blocked").className).toContain("status-blocked");
    expect(getStatusMeta("complete").className).toContain("status-complete");
  });
  it("STATUS_ORDER lists all five statuses once, blocked last", () => {
    expect(STATUS_ORDER).toHaveLength(5);
    expect(new Set(STATUS_ORDER).size).toBe(5);
    expect(STATUS_ORDER.at(-1)).toBe("blocked");
  });
});
```

- [ ] **Step 3: Run — verify FAIL**

Run: `npm test`
Expected: FAIL — `./status` not found.

- [ ] **Step 4: Implement `src/lib/status.ts`**

```ts
export type UnitStatus =
  | "not_started"
  | "in_progress"
  | "complete"
  | "at_risk"
  | "blocked";

// className uses static token utilities so Tailwind can see them at build time.
const META: Record<UnitStatus, { label: string; className: string }> = {
  not_started: { label: "Not started", className: "bg-status-not-started/10 text-status-not-started border-status-not-started/20" },
  in_progress: { label: "In progress", className: "bg-status-in-progress/10 text-status-in-progress border-status-in-progress/20" },
  complete: { label: "Complete", className: "bg-status-complete/10 text-status-complete border-status-complete/20" },
  at_risk: { label: "At risk", className: "bg-status-at-risk/10 text-status-at-risk border-status-at-risk/20" },
  blocked: { label: "Blocked", className: "bg-status-blocked/10 text-status-blocked border-status-blocked/20" },
};

export const STATUS_ORDER: UnitStatus[] = [
  "not_started",
  "in_progress",
  "complete",
  "at_risk",
  "blocked",
];

export function getStatusMeta(status: UnitStatus) {
  return META[status];
}
```

- [ ] **Step 5: Run — verify PASS**

Run: `npm test`
Expected: PASS (status tests + the 6 pre-existing tests).

- [ ] **Step 6: Implement `StatusBadge`**

`src/components/status-badge.tsx`:

```tsx
import { getStatusMeta, type UnitStatus } from "@/lib/status";
import { cn } from "@/lib/utils";

export function StatusBadge({ status, className }: { status: UnitStatus; className?: string }) {
  const meta = getStatusMeta(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium",
        meta.className,
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {meta.label}
    </span>
  );
}
```

- [ ] **Step 7: Verify + commit**

```bash
npx tsc --noEmit && npm run build && npm test
git add src/lib/status.ts src/lib/status.test.ts src/components/status-badge.tsx src/components/ui/badge.tsx
git commit -m "feat(ui): status palette + StatusBadge (tested)"
```

---

## Task 3: App shell — sidebar + top bar

**Files:**
- Create: `src/components/shell/nav.ts` (nav config)
- Create: `src/components/shell/app-sidebar.tsx` (client — collapse + active state)
- Create: `src/components/shell/top-bar.tsx` (client — mobile sidebar trigger + slot)
- Create: `src/components/shell/app-shell.tsx` (composes sidebar + top bar + main)
- Modify: `src/app/(dashboard)/layout.tsx` (render `AppShell` instead of the old header)
- Add: shadcn `tooltip`, `separator`, `avatar`

**Interfaces:**
- Consumes: `requireOrg()`, `signOut` (existing); `ThemeToggle` (Task 1).
- Produces: `AppShell({ org, userEmail, children })` renders the full frame.

- [ ] **Step 1: Add primitives**

```bash
npx shadcn@latest add tooltip separator avatar -y
```

- [ ] **Step 2: Nav config**

`src/components/shell/nav.ts`:

```ts
import { LayoutGrid, FileStack } from "lucide-react";

export const NAV_ITEMS = [
  { href: "/rollouts", label: "Rollouts", icon: LayoutGrid },
  { href: "/templates", label: "Templates", icon: FileStack },
] as const;
```

- [ ] **Step 3: Sidebar (client)**

`src/components/shell/app-sidebar.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "./nav";
import { signOut } from "@/features/auth/actions";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

export function AppSidebar({ org, userEmail }: { org: string; userEmail: string }) {
  const pathname = usePathname();
  return (
    <aside className="bg-sidebar text-sidebar-foreground hidden w-56 shrink-0 flex-col border-r md:flex">
      <div className="flex h-12 items-center px-4 text-sm font-semibold">{org}</div>
      <nav className="flex-1 space-y-0.5 px-2 py-2">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
        <span className="text-muted-foreground truncate text-xs">{userEmail}</span>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <form action={signOut}>
            <button type="submit" className="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
```

(If shadcn did not define `--sidebar`/`--sidebar-foreground` tokens, use `bg-background`/`text-foreground` instead — READ globals.css and pick whichever exists.)

- [ ] **Step 4: Top bar (client)**

`src/components/shell/top-bar.tsx`:

```tsx
"use client";

export function TopBar({ title }: { title?: string }) {
  return (
    <header className="flex h-12 items-center gap-3 border-b px-4">
      <span className="text-sm font-medium">{title}</span>
    </header>
  );
}
```

- [ ] **Step 5: Shell composition**

`src/components/shell/app-shell.tsx`:

```tsx
import { AppSidebar } from "./app-sidebar";
import { TopBar } from "./top-bar";

export function AppShell({
  org,
  userEmail,
  children,
}: {
  org: string;
  userEmail: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1">
      <AppSidebar org={org} userEmail={userEmail} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex flex-1 flex-col p-6">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Render the shell in the dashboard layout**

Replace the header in `src/app/(dashboard)/layout.tsx` with the shell (keep `Providers` + `requireOrg()`):

```tsx
import { requireOrg } from "@/lib/auth/session";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/shell/app-shell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { org, user } = await requireOrg();
  return (
    <Providers>
      <AppShell org={org.name} userEmail={user.email ?? ""}>
        {children}
      </AppShell>
    </Providers>
  );
}
```

- [ ] **Step 7: Verify + commit**

```bash
npx tsc --noEmit && npm run build
```
Expected: build passes; `/rollouts` still a dynamic route. Commit:

```bash
git add src/components/shell "src/app/(dashboard)/layout.tsx" src/components/ui/tooltip.tsx src/components/ui/separator.tsx src/components/ui/avatar.tsx
git commit -m "feat(ui): Linear-style sidebar + top-bar app shell"
```

**Controller visual checkpoint:** log in → confirm the sidebar (org name, Rollouts/Templates with active highlight in teal), top bar, sign-out + theme toggle in the sidebar footer, and that the unauthenticated guard still redirects.

---

## Task 4: Command palette + Query provider + toasts

**Files:**
- Create: `src/components/command-menu.tsx` (client — `Cmd-K`, nav + theme commands)
- Modify: `src/components/providers.tsx` (add `QueryClientProvider`, `<Toaster/>`, mount `<CommandMenu/>`)
- Add: shadcn `command`, `sonner`

**Interfaces:**
- Consumes: `useRouter`, `useTheme`.
- Produces: `CommandMenu` (global, opened by `Cmd-K`/`Ctrl-K`), extended `Providers`.

- [ ] **Step 1: Add primitives**

```bash
npx shadcn@latest add command sonner -y
```

- [ ] **Step 2: Command menu (client)**

`src/components/command-menu.tsx`:

```tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { LayoutGrid, FileStack, Moon, Sun } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export function CommandMenu() {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Navigate">
          <CommandItem onSelect={() => go("/rollouts")}>
            <LayoutGrid className="size-4" /> Rollouts
          </CommandItem>
          <CommandItem onSelect={() => go("/templates")}>
            <FileStack className="size-4" /> Templates
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="Preferences">
          <CommandItem
            onSelect={() => {
              setTheme(resolvedTheme === "dark" ? "light" : "dark");
              setOpen(false);
            }}
          >
            {resolvedTheme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            Toggle theme
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
```

- [ ] **Step 3: Extend Providers**

Update `src/components/providers.tsx` to add the query client, toaster, and command menu (keep ThemeProvider outermost):

```tsx
"use client";

import * as React from "react";
import { ThemeProvider } from "next-themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { CommandMenu } from "@/components/command-menu";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(() => new QueryClient());
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        {children}
        <CommandMenu />
        <Toaster />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
```

- [ ] **Step 4: Verify + commit**

```bash
npx tsc --noEmit && npm run build
grep -q "metaKey" src/components/command-menu.tsx && echo "cmd-k wired"
```
Expected: build passes. Commit:

```bash
git add src/components/command-menu.tsx src/components/providers.tsx src/components/ui/command.tsx src/components/ui/sonner.tsx
git commit -m "feat(ui): Cmd-K command palette, query provider, toasts"
```

**Controller visual checkpoint:** log in → press `Cmd-K` → palette opens; navigate + toggle-theme commands work; a `toast()` renders.

---

## Self-Review

**Spec coverage** (against `docs/superpowers/specs/2026-08-07-app-shell-design-system-design.md`):
- Token system, dark/light, teal accent, Inter, status palette → Tasks 1, 2. ✅
- Flat/hairline/small-radii → carried by shadcn base + token overrides (visual, controller-verified). ✅
- Sidebar + top-bar shell, active highlight, sign-out relocation → Task 3. ✅
- `Cmd-K` command palette (nav + theme commands) → Task 4. ✅
- TanStack Query provider + sonner toasts → Task 4. ✅
- StatusBadge + semantic status → Task 2. ✅
- Providers in the dashboard layout (not root); `requireOrg()` unchanged → Tasks 1, 3. ✅
- **Deferred per spec, intentionally absent:** Realtime, full shortcut map, portal per-org theming, domain content, org switching. The spec's "optimistic-UI seed" is **reduced to a documented convention and deferred to the first real mutation (Templates)** — noted here as a deliberate scope refinement (no contrived example in the shell). ✅
- Responsive: sidebar `hidden md:flex`; a full off-canvas mobile drawer is minimal here (top bar reserves the slot) — acceptable for this slice; flagged for follow-up. ⚠️ (documented, not a gap)

**Placeholder scan:** no TBD/TODO; all code blocks complete. Two READ-then-edit steps (globals.css, layout.tsx) give exact values/results rather than literal full-file dumps, because they extend generated files. ✅

**Type consistency:** `UnitStatus`/`getStatusMeta`/`STATUS_ORDER`/`StatusBadge`/`Providers`/`AppShell`/`ThemeToggle`/`CommandMenu`/`NAV_ITEMS` are defined once and consumed consistently; `AppShell` props (`org`, `userEmail`, `children`) match the dashboard layout call. ✅
