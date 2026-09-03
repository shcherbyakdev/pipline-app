# i18n Wave 1 — public booking in Ukrainian (with region detection)

**Spec:** `docs/superpowers/specs/2026-09-02-i18n-design.md` §4 (public rows), §5, §6, §8, §9 row 1.
**Branch:** `feat/i18n-public`, stacked on `feat/i18n-foundation` (PR #105). **Status: BUILT 2026-09-02** — verify green (lint + typecheck + 1237 unit), integration suite green, browser QA 15/15 (en org, `?lang=uk`, `x-vercel-ip-country: UA/PL/US`, uk org, embed, spaces page, booking → manage page in uk, `?lang=en` override).
**Migration:** `0069_org_locale.sql` — `orgs.locale` (format CHECK), `update_org_scheduling(+p_locale default null = keep)`, `create_org_with_page(+p_locale)`.

## Amendment to the spec (this wave)

Public locale resolution gains a **visitor-region** signal (asked for 2026-09-02):

```
?lang=<valid>  →  visitor country (x-vercel-ip-country) in REGION_LOCALES  →  org.locale  →  en
```

`REGION_LOCALES = { UA: "uk" }` — only countries whose language the product
speaks and where it is unambiguous. Nothing maps to `en`, so the org's
choice is never overridden *towards* English; a Ukrainian business abroad
sets `uk` on the Booking page Settings tab and every visitor gets it.
Public server actions resolve the same triple from `x-pathname` (carries the
query) + the country header + `ctx.org.locale`, so an action error reads in
the page's language. Emails still follow `org.locale` (D4) — a visitor who
got Ukrainian by region from an `en` org gets an English mail until
`bookings.locale` (Later).

`data-lang` on the embed snippet is dropped: the embed resolves the same way
and `?lang=` on the iframe `src` is the override.

## Tasks

1. **Resolver** — `src/i18n/public.ts`: `REGION_LOCALES`, `resolvePublicLocale({lang, country, orgLocale})`, `publicRequestLocale(orgLocale, lang?)` (reads headers). `INTL_LOCALES` (`en → en-GB`, `uk → uk`) in `config.ts` so 24h/dd-mm stay. `BookingOrg.locale`, `RenderContext.org.locale`.
2. **Messages** — `public.*` (widget, slot layouts, details, confirmation, manage, spaces/hourly/stay flows, sections' public words, cross-links, meta description, powered-by), `errors.*` (public action errors + public zod messages), `common.loading` reuse. `uk.json` per the glossary.
3. **Pages** — hosted (channel renderer, staff page, spaces page), embed, manage: `setRequestLocale`, `NextIntlClientProvider` (picked namespaces, `timeZone`), `<div lang>`; `generateMetadata` via `getTranslations`; explicit `?lang` carried by cross-links and `rootRedirect`.
4. **Components** — `useTranslations` / `getTranslations`; every visible `"en-GB"` becomes `INTL_LOCALES[useLocale()]`; `templates.ts` when-lines take a `locale` argument (emails keep passing none → Wave 2).
5. **Actions** — `publicErrors(org)` helper → `getTranslations({locale, namespace:"errors"})`; shared `TOO_MANY_REQUESTS` etc. become keys; zod public messages = keys resolved with the Wave 0 `issueMessage` idiom.
6. **Guards** — lint ratchet on the migrated public dirs; `vocab`/`copy`/`metadata`/`templates` tests updated; RPC integration test for `p_locale`; unit tests for the resolver.
7. **QA** — Playwright: `uk` org page/embed/manage; `en` org + `?lang=uk`; `en` org + `x-vercel-ip-country: UA`; 1440 + 390 screenshots for overflow.
8. **Docs** — spec status line, memory note, `graphify update .`, PR.

Out of this wave (stay English, noted): studio preview ghosts and `SECTION_META` (Wave 4), `newSection` seeded titles/CTA (provider content; Wave 4 seeds per org locale), emails (Wave 2), Accept-Language on public pages (not asked; region only).
