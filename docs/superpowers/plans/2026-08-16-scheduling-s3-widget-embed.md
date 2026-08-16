# Scheduling S3 — Widget Customization + Embed — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Themable booking widget (theme/radius/font/colours with contrast guard), iframe embed with auto-resize + snippet UI, live preview in Settings; folds in resend-manage-link and the a11y pair. Spec: `docs/superpowers/specs/2026-08-16-scheduling-s3-widget-embed-design.md`.

**Architecture:** CSS-variable theme layer (`WidgetTheme` wrapper + `globals.css` theme classes) consumed by the widget on all three surfaces (hosted `/book`, new `/embed`, Settings preview). Storage: one `orgs.widget_theme` jsonb written via a validating definer RPC. Embed: `/embed/[handle]` + ResizeObserver→postMessage + static `/embed.js`.

**Tech Stack:** Next.js app router (READ `node_modules/next/dist/docs/` before app-router edits — breaking changes vs training data), Supabase definer RPCs in custom SQL migrations, Drizzle, Vitest (`npm run test`, `npm run test:integration` — local stack, ports +30), Tailwind v4 + `globals.css`, `next/font`.

## Global Constraints

- Branch: `scheduling-s3` (exists, cut from post-#25 main; spec committed at 8236eda).
- RPC idiom (0026/0028/0030): `security definer`, `set search_path = ''`, org scope via `org_id in (select public.user_orgs())`, uniform `raise exception 'not found'`, `revoke all` then `grant execute` to exactly the intended role.
- `update_org_widget_theme` validates EVERYTHING server-side: enums, `^#[0-9a-f]{6}$`, font whitelist, boolean type. Client contrast guard is UX; the RPC is the boundary.
- Contrast policy: warn `< 4.5`, block save `< 3` (both client form and server action).
- Curated font ids (exact): `system`, `inter`, `dm-sans`, `lora`, `space-grotesk`, `ibm-plex-mono`. Widget surfaces only — never the dashboard shell.
- Embed snippet has NO SRI on the script tag — deliberate, recorded in spec (first-party evergreen script; pinning breaks customers on update). Do not "fix" this.
- Honest toasts (S2 rule): never claim an email was sent unless it was; `noEmail` is a distinct success outcome.
- Server actions: zod `safeParse` on `unknown`, `GENERIC_WRITE_ERROR`, `fail(context, error)`, `revalidatePath` after writes.
- `npm run verify` before every commit; commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- After final task: `graphify update .`

---

### Task 1: DB — `orgs.widget_theme` + `update_org_widget_theme` + `rotate_booking_token`

**Files:**
- Modify: `src/db/schema/orgs.ts` (add jsonb column)
- Create: `src/db/migrations/0032_*.sql` (generated), `src/db/migrations/0033_s3_widget_security.sql` (custom)
- Test: `src/features/scheduling/s3-rpc.integration.test.ts`

**Interfaces:**
- Produces RPC `update_org_widget_theme(p_org_id uuid, p_theme jsonb) returns void` — null clears; validates per-key; grant `authenticated`.
- Produces RPC `rotate_booking_token(p_booking_id uuid, p_token_hash text) returns uuid` — org-scoped, confirmed + future only; replaces `cancel_token_hash` (old manage link dies); grant `authenticated`.

- [ ] **Step 1: Write the failing integration test.** Copy the header scaffolding (env, `admin`/`anon` clients, `signedInUser`, `beforeAll` org+service+rules setup, unique handle) from `lifecycle-rpc.integration.test.ts`; `generateAccessToken` from `@/lib/tokens/mint`. Then:

```typescript
describe("update_org_widget_theme", () => {
  it("stores a valid theme and null clears it", async () => {
    const theme = { theme: "dark", radius: "round", font: "inter", hidePoweredBy: true };
    const { error } = await owner.rpc("update_org_widget_theme", { p_org_id: orgId, p_theme: theme });
    expect(error).toBeNull();
    const { data } = await admin.from("orgs").select("widget_theme").eq("id", orgId).single();
    expect(data!.widget_theme).toEqual(theme);
    const { error: clearErr } = await owner.rpc("update_org_widget_theme", { p_org_id: orgId, p_theme: null });
    expect(clearErr).toBeNull();
    const { data: cleared } = await admin.from("orgs").select("widget_theme").eq("id", orgId).single();
    expect(cleared!.widget_theme).toBeNull();
  });

  it("rejects bad enum, bad hex, unknown font, non-boolean flag", async () => {
    for (const bad of [
      { theme: "neon" },
      { background: "#12345" },
      { background: "#GGGGGG" },
      { font: "comic-sans" },
      { hidePoweredBy: "yes" },
    ]) {
      const { error } = await owner.rpc("update_org_widget_theme", { p_org_id: orgId, p_theme: bad });
      expect(error, JSON.stringify(bad)).not.toBeNull();
    }
  });

  it("rejects a non-member", async () => {
    const { error } = await stranger.rpc("update_org_widget_theme", {
      p_org_id: orgId, p_theme: { theme: "dark" },
    });
    expect(error).not.toBeNull();
  });
});

describe("rotate_booking_token", () => {
  it("rotates the hash so the old manage link dies", async () => {
    const first = generateAccessToken();
    const { data: bookingId } = await anon.rpc("create_booking", {
      p_handle: HANDLE, p_service_id: serviceId,
      p_starts_at: "2027-06-01T10:00:00Z", p_name: "Rotate Me",
      p_email: "rotate@example.com", p_note: null, p_token_hash: first.tokenHash,
    });
    const fresh = generateAccessToken();
    const { data: rotated, error } = await owner.rpc("rotate_booking_token", {
      p_booking_id: bookingId, p_token_hash: fresh.tokenHash,
    });
    expect(error).toBeNull();
    expect(rotated).toBe(bookingId);
    const { data: oldResolve } = await anon.rpc("resolve_booking_token", { p_token: first.token });
    expect(oldResolve).toEqual([]);
    const { data: newResolve } = await anon.rpc("resolve_booking_token", { p_token: fresh.token });
    expect((newResolve as unknown[]).length).toBe(1);
  });

  it("rejects foreign, cancelled, and past bookings", async () => {
    const fresh = generateAccessToken();
    const { error: foreignErr } = await stranger.rpc("rotate_booking_token", {
      p_booking_id: "00000000-0000-4000-8000-000000000000", p_token_hash: fresh.tokenHash,
    });
    expect(foreignErr).not.toBeNull();
    // cancelled: create then admin-cancel via status update, then rotate must fail
    const t = generateAccessToken();
    const { data: cancelId } = await anon.rpc("create_booking", {
      p_handle: HANDLE, p_service_id: serviceId,
      p_starts_at: "2027-06-01T12:00:00Z", p_name: "Cancelled",
      p_email: "cancelled@example.com", p_note: null, p_token_hash: t.tokenHash,
    });
    await owner.from("bookings").update({ status: "cancelled_by_provider" }).eq("id", cancelId);
    const { error: cancelledErr } = await owner.rpc("rotate_booking_token", {
      p_booking_id: cancelId, p_token_hash: generateAccessToken().tokenHash,
    });
    expect(cancelledErr).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`PGRST202` function not found): `npm run test:integration -- s3-rpc`

- [ ] **Step 3: Column.** In `src/db/schema/orgs.ts` add `jsonb` to the drizzle-orm/pg-core import and, next to the branding columns:

```typescript
    // Widget appearance (S3). Written ONLY via update_org_widget_theme
    // (same select-only-orgs discipline as branding). Null = all defaults.
    widgetTheme: jsonb("widget_theme"),
```

Run `npm run db:generate`; the generated 0032 must contain only `ALTER TABLE "orgs" ADD COLUMN "widget_theme" jsonb;`.

- [ ] **Step 4: Custom migration.** `npx drizzle-kit generate --custom --name=s3_widget_security`, then fill `0033_s3_widget_security.sql`:

```sql
-- Custom SQL migration file, put your code below! --

-- S3: widget theme write path + manage-link rotation.

-- ---------- Widget theme: full-replace semantics (like update_org_branding).
-- Every present key is validated; unknown keys rejected; null clears.
create or replace function public.update_org_widget_theme(
  p_org_id uuid,
  p_theme jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  if p_org_id is null or p_org_id not in (select public.user_orgs()) then
    raise exception 'not found';
  end if;

  if p_theme is not null then
    if jsonb_typeof(p_theme) <> 'object' then raise exception 'not found'; end if;
    for v_key in select jsonb_object_keys(p_theme) loop
      if v_key not in ('theme','radius','font','background','text','hidePoweredBy') then
        raise exception 'not found';
      end if;
    end loop;
    if p_theme ? 'theme' and p_theme->>'theme' not in ('light','dark','auto') then
      raise exception 'not found';
    end if;
    if p_theme ? 'radius' and p_theme->>'radius' not in ('none','subtle','round') then
      raise exception 'not found';
    end if;
    if p_theme ? 'font' and p_theme->>'font' not in
      ('system','inter','dm-sans','lora','space-grotesk','ibm-plex-mono') then
      raise exception 'not found';
    end if;
    if p_theme ? 'background' and p_theme->>'background' !~ '^#[0-9a-f]{6}$' then
      raise exception 'not found';
    end if;
    if p_theme ? 'text' and p_theme->>'text' !~ '^#[0-9a-f]{6}$' then
      raise exception 'not found';
    end if;
    if p_theme ? 'hidePoweredBy' and jsonb_typeof(p_theme->'hidePoweredBy') <> 'boolean' then
      raise exception 'not found';
    end if;
  end if;

  update public.orgs set widget_theme = p_theme where id = p_org_id;
end;
$$;

revoke all on function public.update_org_widget_theme(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.update_org_widget_theme(uuid, jsonb) to authenticated;

-- ---------- Manage-link rotation: fresh hash, old link dies. Confirmed +
-- future only (a past/cancelled booking has nothing to manage).
create or replace function public.rotate_booking_token(
  p_booking_id uuid,
  p_token_hash text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_booking_id is null then raise exception 'not found'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'not found';
  end if;

  update public.bookings b
    set cancel_token_hash = p_token_hash
    where b.id = p_booking_id
      and b.org_id in (select public.user_orgs())
      and b.status = 'confirmed'
      and b.starts_at > now()
    returning b.id into v_id;
  if v_id is null then raise exception 'not found'; end if;

  return v_id;
end;
$$;

revoke all on function public.rotate_booking_token(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.rotate_booking_token(uuid, text) to authenticated;
```

- [ ] **Step 5: Migrate + test — expect PASS**: `npm run db:migrate && npm run test:integration -- s3-rpc`
- [ ] **Step 6:** `npm run verify`, commit `feat: s3 — widget_theme storage + theme/rotation RPCs`.

---

### Task 2: Theme core — pure module

**Files:**
- Create: `src/lib/widget-theme.ts`
- Test: `src/lib/widget-theme.test.ts`

**Interfaces (produces):**

```typescript
export type WidgetThemeConfig = {
  theme: "light" | "dark" | "auto";
  radius: "none" | "subtle" | "round";
  font: "system" | "inter" | "dm-sans" | "lora" | "space-grotesk" | "ibm-plex-mono";
  background?: string;  // #rrggbb
  text?: string;        // #rrggbb
  hidePoweredBy: boolean;
};
export const WIDGET_THEME_DEFAULTS: WidgetThemeConfig;
export const WIDGET_FONT_IDS: readonly WidgetThemeConfig["font"][];
export function parseWidgetTheme(raw: unknown): WidgetThemeConfig; // stored jsonb|null → config with defaults
export function themeCssVars(config: WidgetThemeConfig, accentColor: string | null): React.CSSProperties;
// custom props: --widget-accent, --widget-radius, plus --widget-bg/--widget-text ONLY when overridden
export function contrastRatio(hexA: string, hexB: string): number; // WCAG 2.x, 1..21
```

Radius map: none→`0px`, subtle→`6px`, round→`12px`. Accent fallback when null: `#0f172a`.

- [ ] **Step 1: Failing tests**

```typescript
import { describe, it, expect } from "vitest";
import {
  WIDGET_THEME_DEFAULTS, parseWidgetTheme, themeCssVars, contrastRatio,
} from "./widget-theme";

describe("parseWidgetTheme", () => {
  it("null → defaults", () => {
    expect(parseWidgetTheme(null)).toEqual(WIDGET_THEME_DEFAULTS);
  });
  it("merges partial stored config over defaults and drops junk", () => {
    expect(parseWidgetTheme({ theme: "dark", font: "lora", bogus: 1 })).toEqual({
      ...WIDGET_THEME_DEFAULTS, theme: "dark", font: "lora",
    });
  });
  it("ignores invalid stored values", () => {
    expect(parseWidgetTheme({ theme: "neon", background: "red" })).toEqual(WIDGET_THEME_DEFAULTS);
  });
});

describe("themeCssVars", () => {
  it("maps radius and accent, omits bg/text unless overridden", () => {
    const vars = themeCssVars({ ...WIDGET_THEME_DEFAULTS, radius: "round" }, "#ff0000");
    expect(vars).toEqual({ "--widget-accent": "#ff0000", "--widget-radius": "12px" });
  });
  it("includes overrides when set and falls back accent", () => {
    const vars = themeCssVars(
      { ...WIDGET_THEME_DEFAULTS, background: "#101010", text: "#fafafa" }, null,
    );
    expect(vars["--widget-bg" as keyof typeof vars]).toBe("#101010");
    expect(vars["--widget-text" as keyof typeof vars]).toBe("#fafafa");
    expect(vars["--widget-accent" as keyof typeof vars]).toBe("#0f172a");
  });
});

describe("contrastRatio", () => {
  it("black on white is 21, self is 1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#808080", "#808080")).toBe(1);
  });
  it("is symmetric and flags low-contrast pairs", () => {
    expect(contrastRatio("#777777", "#888888")).toBeLessThan(1.3);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(contrastRatio("#000000", "#ffffff"), 5);
  });
});
```

- [ ] **Step 2: Run — FAIL** (module missing). **Step 3: Implement** (WCAG: linearize sRGB channels `c<=0.03928 ? c/12.92 : ((c+0.055)/1.055)^2.4`, L = 0.2126R+0.7152G+0.0722B, ratio = (Lmax+0.05)/(Lmin+0.05); `parseWidgetTheme` validates each field individually against the same rules as the RPC and keeps valid ones). **Step 4: PASS.** **Step 5:** verify + commit `feat: s3 — widget theme core (config, css vars, contrast)`.

---

### Task 3: `WidgetTheme` component, theme CSS, fonts, widget token swap

**Files:**
- Create: `src/components/widget-theme.tsx`, `src/lib/widget-fonts.ts`
- Modify: `src/app/globals.css`, `src/features/scheduling/components/booking-widget.tsx`, `src/app/book/[handle]/page.tsx`

**Interfaces:**
- Produces `<WidgetTheme config accentColor>{children}</WidgetTheme>`: wrapper div with class `widget-theme wt-<theme>` + font class + `themeCssVars` inline style. Tasks 4–5 consume it.

- [ ] **Step 1: Fonts module** (`src/lib/widget-fonts.ts`): `next/font/google` instances for Inter, DM_Sans, Lora, Space_Grotesk, IBM_Plex_Mono (`subsets: ["latin"]`), export `widgetFontClass(font): string` (`system` → `""`). NOTE: root layout already loads Inter/JetBrains Mono for the app — these instances are separate and only referenced from widget surfaces.

- [ ] **Step 2: globals.css theme classes** (append; Tailwind v4 file — plain CSS at the end):

```css
/* S3 widget theme surface. Inline style overrides (--widget-bg/--widget-text
   from per-org config) win over these class defaults. */
.widget-theme {
  background: var(--widget-bg);
  color: var(--widget-text);
}
.widget-theme :is(button, input, textarea, select, [class*="rounded"]) {
  border-radius: var(--widget-radius);
}
.wt-light { --widget-bg: #ffffff; --widget-text: #18181b; --widget-line: #e4e4e7; }
.wt-dark  { --widget-bg: #18181b; --widget-text: #fafafa; --widget-line: #3f3f46; }
.wt-auto  { --widget-bg: #ffffff; --widget-text: #18181b; --widget-line: #e4e4e7; }
@media (prefers-color-scheme: dark) {
  .wt-auto { --widget-bg: #18181b; --widget-text: #fafafa; --widget-line: #3f3f46; }
}
.widget-theme .wt-primary {
  background: var(--widget-accent);
  color: #ffffff;
  border-color: transparent;
}
.widget-theme :is(.border, [class*="border"]) { border-color: var(--widget-line); }
```

- [ ] **Step 3: `WidgetTheme` component**

```tsx
import type { WidgetThemeConfig } from "@/lib/widget-theme";
import { themeCssVars } from "@/lib/widget-theme";
import { widgetFontClass } from "@/lib/widget-fonts";
import { cn } from "@/lib/utils";

export function WidgetTheme({
  config, accentColor, className, children,
}: {
  config: WidgetThemeConfig;
  accentColor: string | null;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn("widget-theme", `wt-${config.theme}`, widgetFontClass(config.font), className)}
      style={themeCssVars(config, accentColor)}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Token swap in `booking-widget.tsx`** — minimal, targeted: add `wt-primary` to the confirm button (`<Button type="submit" className="wt-primary" …>`) and to the selected-state slot button path (slot buttons stay `outline`; on click they advance state, so only confirm needs accent), keep everything else consuming the wrapper's bg/text/radius via the CSS above. No structural changes in this task.

- [ ] **Step 5: Hosted page adopts the wrapper.** In `book/[handle]/page.tsx`: fetch `widget_theme` (extend `getOrgBranding` in `src/lib/org-branding.ts` to also select `widget_theme` and return `themeRaw: unknown`), then wrap:

```tsx
<WidgetTheme config={parseWidgetTheme(branding.themeRaw)} accentColor={branding.accentColor}>
  <BookingWidget … />
</WidgetTheme>
```

- [ ] **Step 6:** `npm run verify`; manual dev check of `/book/<handle>` in default + dark stored theme (set via SQL for the check); commit `feat: s3 — WidgetTheme layer + hosted page adoption`.

---

### Task 4: Embed — route, resize reporter, embed.js, headers

**Files:**
- Create: `src/app/embed/[handle]/page.tsx`, `src/app/embed/layout.tsx`, `src/features/scheduling/components/embed-resize-reporter.tsx`, `public/embed.js`
- Modify: `next.config.ts` (noindex header for `/embed/:path*`)

**Interfaces:**
- Consumes: `WidgetTheme`, `parseWidgetTheme`, `getBookingOrg`, `listPublicServices`, `getOrgBranding`.
- Produces: `/embed/[handle]` page and the postMessage contract `{ type: "rollout-resize", height: number }`.

- [ ] **Step 1: Resize reporter** (`embed-resize-reporter.tsx`):

```tsx
"use client";

import * as React from "react";

// Height-only broadcast; no secrets, so targetOrigin "*" is acceptable —
// the PARENT side (embed.js) does the authenticating (source check).
export function EmbedResizeReporter() {
  React.useEffect(() => {
    const post = () =>
      window.parent?.postMessage(
        { type: "rollout-resize", height: document.documentElement.scrollHeight },
        "*",
      );
    const ro = new ResizeObserver(post);
    ro.observe(document.body);
    post();
    return () => ro.disconnect();
  }, []);
  return null;
}
```

- [ ] **Step 2: Embed layout + page.** Layout: bare `<main className="p-4">{children}</main>` (no max-w — the iframe's box is the constraint). Page mirrors `book/[handle]/page.tsx`'s fetch + notFound guards, then:

```tsx
<WidgetTheme config={theme} accentColor={branding.accentColor}>
  <EmbedResizeReporter />
  {branding.logoUrl ? (
    <img src={branding.logoUrl} alt={org.orgName} className="mb-4 h-8 w-auto" />
  ) : null}
  <BookingWidget handle={handle} orgTimeZone={org.timeZone} services={services} />
  {theme.hidePoweredBy ? null : (
    <p className="mt-4 text-center text-xs opacity-60">
      <a href={appUrl} target="_blank" rel="noopener noreferrer">Powered by RolloutOS</a>
    </p>
  )}
</WidgetTheme>
```

(`appUrl` from `env.NEXT_PUBLIC_APP_URL`.)

- [ ] **Step 3: `public/embed.js`** — re-query per message (late-added iframes), source-verify:

```js
(function () {
  "use strict";
  window.addEventListener("message", function (e) {
    if (!e.data || e.data.type !== "rollout-resize") return;
    var frames = document.querySelectorAll("iframe[data-rollout-embed]");
    for (var i = 0; i < frames.length; i++) {
      if (frames[i].contentWindow === e.source) {
        var h = Number(e.data.height);
        if (isFinite(h) && h > 0) frames[i].style.height = Math.ceil(h) + "px";
      }
    }
  });
})();
```

- [ ] **Step 4: Headers.** In `next.config.ts` add `{ source: "/embed/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex" }] }` to the returned array. Do NOT add any frame-blocking header anywhere (none exists today; embeds must stay frameable).

- [ ] **Step 5: Manual iframe check.** Write `/private/tmp/…scratchpad/embed-fixture.html` (plain page with the snippet pointing at `http://localhost:3000/embed/<handle>` + `<script src="http://localhost:3000/embed.js">`), open via `python3 -m http.server` in the scratchpad, verify the iframe grows/shrinks as services/slots render. Note results in commit body.

- [ ] **Step 6:** verify + commit `feat: s3 — /embed route with auto-resize + embed.js`.

---

### Task 5: Settings — theme form, live preview, snippet card

**Files:**
- Modify: `src/features/orgs/schema.ts` (zod), `src/features/orgs/actions.ts` (action), `src/features/orgs/queries.ts` (`getBrandingSettings` also returns `widgetTheme` raw), `src/app/(dashboard)/settings/page.tsx`
- Create: `src/features/orgs/components/widget-appearance.tsx` (client: form + preview + snippet)
- Modify: `src/features/scheduling/components/booking-widget.tsx` (preview prop)

**Interfaces:**
- Consumes: `widgetThemeInput` (below), `update_org_widget_theme` RPC (Task 1), `WidgetTheme`, `contrastRatio`, `WIDGET_THEME_DEFAULTS`.
- Produces: `updateWidgetTheme(input: unknown): Promise<ActionState>`; `BookingWidget` gains `preview?: { slots: string[] }`.

- [ ] **Step 1: zod input** (in `src/features/orgs/schema.ts`):

```typescript
const hexField = z.string().regex(/^#[0-9a-f]{6}$/);
export const widgetThemeInput = z.object({
  theme: z.enum(["light", "dark", "auto"]),
  radius: z.enum(["none", "subtle", "round"]),
  font: z.enum(["system", "inter", "dm-sans", "lora", "space-grotesk", "ibm-plex-mono"]),
  background: hexField.optional(),
  text: hexField.optional(),
  hidePoweredBy: z.boolean(),
});
```

- [ ] **Step 2: Action** (in `orgs/actions.ts`, `currentOrgBranding`/`brandingFail` idiom):

```typescript
const CONTRAST_BLOCK = "Text and background contrast is below 3:1 — pick more distinct colours.";

export async function updateWidgetTheme(input: unknown): Promise<ActionState> {
  const parsed = widgetThemeInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const cfg = parsed.data;
  // Server-side contrast floor (mirrors the form's block threshold). Only
  // meaningful when both overrides are present; theme-pair defaults pass.
  if (cfg.background && cfg.text && contrastRatio(cfg.background, cfg.text) < 3) {
    return { ok: false, error: CONTRAST_BLOCK };
  }
  const { org, error: orgError } = await currentOrgBranding();
  if (!org) return brandingFail("updateWidgetTheme", orgError ?? "no org");
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_org_widget_theme", {
    p_org_id: org.id,
    p_theme: cfg,
  });
  if (error) return brandingFail("updateWidgetTheme", error);
  revalidatePath("/settings");
  revalidatePath("/bookings");
  return { ok: true };
}
```

- [ ] **Step 3: Widget preview prop.** In `booking-widget.tsx`: `preview?: { slots: string[] }`. When set: `loadSlots` sets `setSlots(preview.slots)` without calling `getSlots`; the confirm button renders `disabled` with text `"Preview"` and `submit` returns early. No other flow changes — service list and slot grid behave normally.

- [ ] **Step 4: `widget-appearance.tsx`** (client component; receives `initial: WidgetThemeConfig`, `accentColor`, `handle: string | null`, `appUrl: string`, `previewServices: PublicService[]`):
  - Form controls: native `<select>` for theme/radius/font (create-booking-dialog idiom), two `<input type="color">` + clear buttons for background/text, checkbox for `hidePoweredBy`; local state `config`.
  - Contrast line: when both overrides set, show ratio (1 decimal); `< 4.5` amber warning copy, `< 3` destructive copy + disable Save.
  - Save button → `updateWidgetTheme(config)` → toast success/error.
  - Live preview beside the form (`lg:grid-cols-2`, stacked below `lg`): `<WidgetTheme config={config} accentColor={accentColor}><BookingWidget handle="preview" orgTimeZone="UTC" services={previewServices} preview={{ slots: CANNED_SLOTS }} /></WidgetTheme>` where `CANNED_SLOTS` is 6 ISO strings across two future days (hardcoded const).
  - Snippet card (only when `handle` non-null): `<pre>` with the exact spec snippet (`${appUrl}/embed/${handle}` + `${appUrl}/embed.js`), Copy button via `navigator.clipboard.writeText` + success toast. When `handle` is null: muted hint "Publish a booking handle in Scheduling settings to get your embed code."
  - `previewServices`: pass the org's real active services from the page (fallback: one canned service object if none exist).
- [ ] **Step 5: Settings page wiring.** Extend `getBrandingSettings` to select `widget_theme` (raw). In `settings/page.tsx` render `<WidgetAppearance …>` below the branding form, passing `parseWidgetTheme(raw)`, accent, handle (from `getSchedulingSettings`), `env.NEXT_PUBLIC_APP_URL`, services (via `listServices()` filtered active, mapped to the public shape).
- [ ] **Step 6:** verify; manual: change theme/radius in the form and watch the preview update pre-save; save and confirm `/book` + `/embed` pick it up. Commit `feat: s3 — widget appearance settings, live preview, embed snippet`.

---

### Task 6: Resend manage link

**Files:**
- Modify: `src/features/scheduling/templates.ts`, `src/features/scheduling/booking-actions.ts`, `src/features/scheduling/components/booking-detail-dialog.tsx`, `src/features/scheduling/components/bookings-list.tsx`

**Interfaces:**
- Consumes: `rotate_booking_token` (Task 1), `generateAccessToken`, `buildBookingManageUrl`, `selectTransport`, `bookingLifecycleKey`, `formatWhenLine`.
- Produces: `resendManageLink(input: unknown): Promise<{ ok: true; emailed: boolean } | { ok: false; error: string; noEmail?: boolean }>`.

- [ ] **Step 1: Template** (`templates.ts`, mirror `bookingConfirmationEmail`'s shape):

```typescript
export function bookingManageLinkEmail(input: {
  orgName: string;
  serviceName: string;
  whenLine: string;
  manageUrl: string;
  icsUrl: string;
}): { subject: string; html: string; text: string } {
  const subject = `Your booking link — ${input.serviceName} with ${input.orgName}`;
  const intro = `Here is a fresh link to view, reschedule, or cancel your booking (${input.whenLine}). Any previous link no longer works.`;
  // html/text assembled with the file's existing helpers/layout idiom
  …
}
```

(Adapt body assembly to the file's existing helper structure — read it first.)

- [ ] **Step 2: Action** (`booking-actions.ts`):

```typescript
export async function resendManageLink(
  input: unknown,
): Promise<{ ok: true; emailed: boolean } | { ok: false; error: string; noEmail?: boolean }> {
  const parsed = bookingIdInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  try {
    const org = await currentOrg();
    if (!org) return { ok: false, error: GENERIC_WRITE_ERROR };
    const supabase = await createClient();
    const { data: booking, error: readError } = await supabase
      .from("bookings")
      .select("id, client_email, starts_at, services(name)")
      .eq("id", parsed.data.id).eq("org_id", org.id).eq("status", "confirmed")
      .maybeSingle();
    if (readError) return fail("resendManageLink", readError);
    if (!booking) return { ok: false, error: "Only a confirmed booking has a manage link." };
    if (!booking.client_email) {
      return { ok: false, error: "No email on file for this client.", noEmail: true };
    }

    const fresh = generateAccessToken();
    const { error } = await supabase.rpc("rotate_booking_token", {
      p_booking_id: booking.id,
      p_token_hash: fresh.tokenHash,
    });
    if (error) return fail("resendManageLink", error);

    let emailed = true;
    try {
      const msg = bookingManageLinkEmail({
        orgName: org.name,
        serviceName: (booking as { services: { name: string } | null }).services?.name ?? "Appointment",
        whenLine: formatWhenLine(new Date(booking.starts_at), org.timezone),
        manageUrl: buildBookingManageUrl(fresh.token),
        icsUrl: `${env.NEXT_PUBLIC_APP_URL}/booking/${fresh.token}/calendar.ics`,
      });
      await selectTransport().send({
        to: booking.client_email,
        subject: msg.subject, html: msg.html, text: msg.text,
        // Keyed per rotation (hash prefix) — resending later must not be
        // deduped against the previous send.
        idempotencyKey: bookingLifecycleKey(booking.id, `manage-${fresh.tokenHash.slice(0, 8)}`),
      });
    } catch (mailError) {
      console.error("[scheduling] resend manage link email failed:", mailError);
      emailed = false;
    }
    return { ok: true, emailed };
  } catch (error) {
    return fail("resendManageLink", error);
  }
}
```

(If `bookingLifecycleKey`'s kind parameter is a closed union, widen it or add a sibling key helper — check the signature first.)

- [ ] **Step 3: UI.** `BookingDetailDialog`: a "Resend link" ghost button beside Reschedule/Cancel — disabled with `title="No email on file"` when `booking.clientEmail` is null. Toasts: emailed → `"A fresh booking link is on its way to the client."`; `ok && !emailed` → warning `"Link was reset, but the email failed — the old link no longer works. Contact the client directly."`; error → `toast.error`. Same button in `bookings-list.tsx`'s upcoming `Row` actions.
- [ ] **Step 4:** verify + commit `feat: s3 — resend manage link (token rotation + email)`.

---

### Task 7: A11y pass (S1 pair)

**Files:**
- Modify: `src/features/scheduling/components/booking-widget.tsx`, `src/features/scheduling/components/availability-editor.tsx`

- [ ] **Step 1: Widget.**
  - Wrap the slots region (loading / empty / day-grouped buttons) in `<div aria-live="polite">`.
  - Slot buttons: `aria-label={\`${dayFmt.format(new Date(s))}, ${timeFmt.format(new Date(s))}\`}` (visible label stays time-only).
  - After picking a service, move focus to the slots region: `ref` + `tabIndex={-1}` + `.focus()` in the service-select handler (event-driven, no effect-set-state).
  - The empty `"change"` button when `services.length === 1` renders an empty accessible name — render nothing instead (conditional already exists for label text; make the button itself conditional).
- [ ] **Step 2: Availability editor.** Audit inputs: every `<Input>`/`<select>` gets a `<Label htmlFor>` or `aria-label` (weekday selects, time fields, exception date/time fields); confirm delete buttons keep their existing `aria-label`; ensure focus-visible is not suppressed anywhere (no `outline-none` without replacement).
- [ ] **Step 3:** Keyboard walk-through in dev (tab through book flow start→confirm; screen-reader smoke optional), verify + commit `fix: s3 — widget + availability editor a11y (focus order, labels, aria-live)`.

---

### Task 8: Final sweep

- [ ] **Step 1:** `npm run verify && npm run test:integration` (local stack).
- [ ] **Step 2:** `graphify update .`
- [ ] **Step 3:** Record execution deviations in this plan file; commit.
- [ ] **Step 4:** superpowers:finishing-a-development-branch — PR targets `main`.
