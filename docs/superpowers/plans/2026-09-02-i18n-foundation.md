# i18n Foundation (Wave 0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the whole i18n mechanism in place (next-intl, locale cookie + `user_metadata`, message files, fallback, guards, switcher) and prove it end to end by shipping the auth pages fully in English and Ukrainian.

**Architecture:** `next-intl` without URL routing. `src/i18n/request.ts` resolves the locale per request (explicit `requestLocale` → `NEXT_LOCALE` cookie → `Accept-Language` → `en`) and loads `messages/<locale>.json` deep-merged over `messages/en.json`. The `(auth)` and `(dashboard)` layouts wrap their trees in `NextIntlClientProvider` and set `lang` on their wrapper; the root layout is untouched (marketing stays static until Wave 5). A server action writes the cookie and `user_metadata.locale`; the proxy seeds the cookie from `user_metadata` on a new device.

**Tech Stack:** Next.js 16.3 App Router, React 19.2, next-intl 4.14, Supabase auth (`user_metadata`), Vitest, `intl-messageformat` (test-only), ESLint `react/jsx-no-literals` (already inside `eslint-config-next`).

**Spec:** `docs/superpowers/specs/2026-09-02-i18n-design.md` (§2 decisions D1–D9, §3 architecture, §4 resolution, §5 conventions, §6 guards, §8 data)

## Global Constraints

- Branch: `git fetch origin && git switch -c feat/i18n-foundation origin/main`. Verify `ls src/db/migrations | tail -1` shows `0068_surface_themes.sql`. **No migration in this wave** (`orgs.locale` is Wave 1's 0069).
- Locale codes: `en`, `uk` (never `ua`). Cookie name: `NEXT_LOCALE`. Message files: `messages/en.json`, `messages/uk.json` at the repo root.
- Keys are semantic camelCase, nested by component (`auth.login.submit`), never the English sentence. One sentence = one message; no concatenation. Rich text through `t.rich` with `<link>…</link>` tags.
- Never translated: "Booklo", `LOCALE_NAMES` (each language in itself), URLs, the `you@company.com` placeholder (on the `SAME_IN_EVERY_LOCALE` allowlist).
- Ukrainian style: formal **ви**, imperative buttons, no exclamation marks, sentence case. Use the typographic apostrophe `’` inside Ukrainian words (`з’являвся`).
- The root layout (`src/app/layout.tsx`) changes only its Inter `subsets`. No `getLocale()` there (it would make the static marketing pages dynamic — spec §3).
- Nothing reads `navigator.language`. The locale is decided on the server and handed down.
- `npm run verify` = lint + typecheck + unit tests; it must pass at the end of every task. Browser QA drives `localhost:3000`, never `127.0.0.1`.
- After code changes land, run `graphify update .` once (Task 7).
- Every commit message ends with:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01RDSMQQqqYie1pNEpoLjJ5t
  ```

---

### Task 1: Locale config module

**Files:**
- Modify: `package.json` (via `npm i`)
- Create: `src/i18n/config.ts`
- Test: `src/i18n/config.test.ts`

**Interfaces:**
- Produces: `LOCALES: readonly ["en","uk"]`, `type Locale`, `DEFAULT_LOCALE: Locale`, `LOCALE_NAMES: Record<Locale,string>`, `isLocale(value: unknown): value is Locale`, `negotiateLocale(header: string | null | undefined): Locale`. Every later task imports from here.

- [ ] **Step 1: Install the dependencies**

```bash
npm i next-intl@^4.14.2
npm i -D intl-messageformat
```

`intl-messageformat` is already a transitive dependency of next-intl; declaring it lets `messages.test.ts` (Task 2) import it honestly.

- [ ] **Step 2: Write the failing test**

Create `src/i18n/config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { DEFAULT_LOCALE, LOCALES, LOCALE_NAMES, isLocale, negotiateLocale } from "./config";

describe("locale config", () => {
  it("names every locale in itself", () => {
    for (const l of LOCALES) expect(LOCALE_NAMES[l]).toBeTruthy();
    expect(LOCALE_NAMES.uk).toBe("Українська");
  });

  it("isLocale accepts only listed codes", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("uk")).toBe(true);
    for (const bad of ["ua", "UK", "en-GB", "", null, undefined, 1]) expect(isLocale(bad)).toBe(false);
  });

  it("negotiateLocale picks the best supported language by q-value, base language only", () => {
    expect(negotiateLocale("uk-UA,uk;q=0.9,en;q=0.8")).toBe("uk");
    expect(negotiateLocale("en-US,en;q=0.9,uk;q=0.8")).toBe("en");
    expect(negotiateLocale("uk;q=0.5,en;q=0.9")).toBe("en");
    expect(negotiateLocale("UK-ua")).toBe("uk");
  });

  it("negotiateLocale falls back to the default on unknown, empty, wildcard or zero-weight input", () => {
    expect(negotiateLocale(null)).toBe(DEFAULT_LOCALE);
    expect(negotiateLocale(undefined)).toBe(DEFAULT_LOCALE);
    expect(negotiateLocale("")).toBe(DEFAULT_LOCALE);
    expect(negotiateLocale("*")).toBe(DEFAULT_LOCALE);
    expect(negotiateLocale("ru,pl;q=0.9")).toBe(DEFAULT_LOCALE);
    expect(negotiateLocale("uk;q=0")).toBe(DEFAULT_LOCALE);
    expect(negotiateLocale("uk;q=abc")).toBe(DEFAULT_LOCALE);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/i18n/config.test.ts`
Expected: FAIL — `Cannot find module './config'`.

- [ ] **Step 4: Write the module**

Create `src/i18n/config.ts`:

```ts
// The list of languages the product speaks (spec 2026-09-02 §10: adding one
// is a line here, a loader line in messages.ts and a messages/<code>.json).
// Codes are ISO 639-1 language codes — Ukrainian is `uk`, never `ua`.
export const LOCALES = ["en", "uk"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** Each language named in itself. Shown in the switcher; never translated. */
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", uk: "Українська" };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Accept-Language → the best supported locale by q-value, matching on the
    base language only ("uk-UA" → "uk"). Unknown, empty or zero-weight → the
    default. Tiny on purpose: two locales do not need a matcher library. */
export function negotiateLocale(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  const ranked = header
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const weight = q ? Number(q.slice(2)) : 1;
      return { lang: tag.trim().toLowerCase().split("-")[0], weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter((r) => r.lang !== "" && r.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  for (const r of ranked) if (isLocale(r.lang)) return r.lang;
  return DEFAULT_LOCALE;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/i18n/config.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/i18n/config.ts src/i18n/config.test.ts
git commit -m "feat(i18n): locale config — LOCALES, names, Accept-Language negotiation"
```

---

### Task 2: Messages, fallback loader, request config, typed keys

**Files:**
- Create: `messages/en.json`, `messages/uk.json`
- Create: `src/i18n/messages.ts`, `src/i18n/request.ts`, `src/types/next-intl.d.ts`
- Modify: `next.config.ts`
- Test: `src/i18n/messages.test.ts`

**Interfaces:**
- Consumes: `LOCALES`, `Locale`, `DEFAULT_LOCALE`, `isLocale`, `negotiateLocale` (Task 1); `LOCALE_COOKIE` (Task 3 — create `src/i18n/cookie.ts` there; this task's `request.ts` imports it, so Task 3's Step 1 may be done first or the import added when Task 3 lands. Simplest: do Task 3 Step 1 now).
- Produces: `loadMessages(locale: Locale): Promise<AbstractIntlMessages>`, `deepMerge(base, over)`, the next-intl request config, `AppConfig` typing so `t("auth.login.titel")` fails `tsc`. Message namespaces `common`, `settings.language`, `auth` used by Tasks 4–5.

- [ ] **Step 1: Write `messages/en.json`**

```json
{
  "common": {
    "language": "Language",
    "loading": "Loading…"
  },
  "settings": {
    "language": {
      "title": "Language",
      "blurb": "For your admin. The language your clients see is set on your booking page.",
      "label": "Interface language"
    }
  },
  "auth": {
    "email": "Email",
    "emailPlaceholder": "you@company.com",
    "password": "Password",
    "passwordHint": "At least 8 characters.",
    "login": {
      "title": "Sign in",
      "expiredLink": "That link is invalid or has expired — request a new one.",
      "noAccount": "Don't have an account? <link>Sign up</link>",
      "forgot": "Forgot password?",
      "submit": "Sign in",
      "submitting": "Signing in…",
      "useMagic": "Email me a magic link instead",
      "usePassword": "Sign in with a password instead",
      "magicSent": "Check your email for a magic link to sign in.",
      "sendMagic": "Send magic link",
      "sending": "Sending…"
    },
    "signup": {
      "title": "Create your account",
      "blurb": "You'll confirm your email before signing in.",
      "claiming": "Claiming <handle>{claimed}</handle>",
      "sent": "Check your email to confirm your account.",
      "sentClaimed": "Check your email to confirm your account and claim {claimed}.",
      "submit": "Create account",
      "submitting": "Creating account…",
      "haveAccount": "Already have an account? <link>Sign in</link>"
    },
    "forgot": {
      "title": "Reset your password",
      "blurb": "We'll email you a link to set a new one.",
      "expired": "That reset link was already used or has expired — request a new one.",
      "sent": "If an account exists for that address, you'll receive a password reset link.",
      "submit": "Send reset link",
      "sending": "Sending…",
      "back": "Back to sign in"
    },
    "reset": {
      "title": "Set a new password",
      "blurb": "You're signed in via your reset link — choose a new password.",
      "newPassword": "New password",
      "confirm": "Confirm new password",
      "submit": "Set new password",
      "saving": "Saving…"
    },
    "errors": {
      "emailInvalid": "Enter a valid email address.",
      "credentialsInvalid": "Enter a valid email and password.",
      "signInFailed": "Invalid email or password.",
      "linkFailed": "Could not send the link. Try again shortly.",
      "passwordMin": "Password must be at least 8 characters.",
      "passwordsMismatch": "Passwords don't match.",
      "passwordInvalid": "Enter a valid password.",
      "passwordWeak": "That password is too common or has appeared in a data breach — choose another.",
      "tooManyAttempts": "Too many attempts — wait a few minutes and try again.",
      "signUpFailed": "Could not create your account. Try again.",
      "handleInvalid": "That page name isn't valid.",
      "handleUnavailable": "That page name isn't available.",
      "resetExpired": "Your reset link has expired — request a new one.",
      "updateFailed": "Could not update your password. Request a new reset link."
    }
  }
}
```

- [ ] **Step 2: Write `messages/uk.json`**

```json
{
  "common": {
    "language": "Мова",
    "loading": "Завантаження…"
  },
  "settings": {
    "language": {
      "title": "Мова",
      "blurb": "Для вашої адмін-панелі. Мову, яку бачать клієнти, ви обираєте на сторінці бронювання.",
      "label": "Мова інтерфейсу"
    }
  },
  "auth": {
    "email": "Електронна пошта",
    "emailPlaceholder": "you@company.com",
    "password": "Пароль",
    "passwordHint": "Щонайменше 8 символів.",
    "login": {
      "title": "Вхід",
      "expiredLink": "Посилання недійсне або його термін минув — запитайте нове.",
      "noAccount": "Немає акаунта? <link>Зареєструватися</link>",
      "forgot": "Забули пароль?",
      "submit": "Увійти",
      "submitting": "Вхід…",
      "useMagic": "Надіслати посилання для входу на пошту",
      "usePassword": "Увійти з паролем",
      "magicSent": "Перевірте пошту — ми надіслали посилання для входу.",
      "sendMagic": "Надіслати посилання для входу",
      "sending": "Надсилаємо…"
    },
    "signup": {
      "title": "Створіть акаунт",
      "blurb": "Перед входом потрібно підтвердити електронну пошту.",
      "claiming": "Закріплюємо адресу <handle>{claimed}</handle>",
      "sent": "Перевірте пошту, щоб підтвердити акаунт.",
      "sentClaimed": "Перевірте пошту, щоб підтвердити акаунт і закріпити адресу {claimed}.",
      "submit": "Створити акаунт",
      "submitting": "Створюємо акаунт…",
      "haveAccount": "Уже є акаунт? <link>Увійти</link>"
    },
    "forgot": {
      "title": "Скидання пароля",
      "blurb": "Ми надішлемо на пошту посилання, щоб задати новий.",
      "expired": "Це посилання вже використане або його термін минув — запитайте нове.",
      "sent": "Якщо для цієї адреси є акаунт, ви отримаєте посилання для скидання пароля.",
      "submit": "Надіслати посилання",
      "sending": "Надсилаємо…",
      "back": "Назад до входу"
    },
    "reset": {
      "title": "Задайте новий пароль",
      "blurb": "Ви увійшли за посиланням для скидання — оберіть новий пароль.",
      "newPassword": "Новий пароль",
      "confirm": "Повторіть новий пароль",
      "submit": "Зберегти пароль",
      "saving": "Зберігаємо…"
    },
    "errors": {
      "emailInvalid": "Введіть дійсну адресу електронної пошти.",
      "credentialsInvalid": "Введіть дійсні електронну пошту та пароль.",
      "signInFailed": "Неправильна електронна пошта або пароль.",
      "linkFailed": "Не вдалося надіслати посилання. Спробуйте трохи пізніше.",
      "passwordMin": "Пароль має містити щонайменше 8 символів.",
      "passwordsMismatch": "Паролі не збігаються.",
      "passwordInvalid": "Введіть дійсний пароль.",
      "passwordWeak": "Цей пароль надто поширений або з’являвся у витоках даних — оберіть інший.",
      "tooManyAttempts": "Забагато спроб — зачекайте кілька хвилин і спробуйте знову.",
      "signUpFailed": "Не вдалося створити акаунт. Спробуйте ще раз.",
      "handleInvalid": "Така адреса сторінки недійсна.",
      "handleUnavailable": "Ця адреса сторінки недоступна.",
      "resetExpired": "Термін дії посилання для скидання минув — запитайте нове.",
      "updateFailed": "Не вдалося оновити пароль. Запитайте нове посилання для скидання."
    }
  }
}
```

- [ ] **Step 3: Write the failing guard test**

Create `src/i18n/messages.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import IntlMessageFormat from "intl-messageformat";
import en from "../../messages/en.json";
import uk from "../../messages/uk.json";
import { LOCALES, type Locale } from "./config";
import { deepMerge } from "./messages";

/* The guards from spec 2026-09-02 §6. Every locale must carry every key,
   compile as ICU, name the same placeholders and tags as English, cover
   every plural category its language has, and actually be translated. */

const MESSAGES: Record<Locale, unknown> = { en, uk };

// Values that are the same in every language on purpose: codes, brand,
// examples. Anything else equal to English is an untranslated string.
const SAME_IN_EVERY_LOCALE = new Set(["auth.emailPlaceholder"]);

function flatten(value: unknown, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  if (typeof value === "string") out[prefix] = value;
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}

const placeholders = (msg: string) => [...msg.matchAll(/\{(\w+)[,}]/g)].map((m) => m[1]).sort();
const tags = (msg: string) => [...msg.matchAll(/<(\w+)>/g)].map((m) => m[1]).sort();

// formatjs AST: 6 = plural, 5 = select (both carry `options`), 8 = tag (`children`).
type Node = { type: number; pluralType?: string; options?: Record<string, { value: Node[] }>; children?: Node[] };
function cardinalPlurals(nodes: Node[], out: Node[] = []): Node[] {
  for (const n of nodes) {
    if (n.type === 6 && n.pluralType !== "ordinal") out.push(n);
    for (const opt of Object.values(n.options ?? {})) cardinalPlurals(opt.value, out);
    if (n.children) cardinalPlurals(n.children, out);
  }
  return out;
}

describe("messages", () => {
  const flatEn = flatten(en);

  for (const locale of LOCALES) {
    const flat = flatten(MESSAGES[locale]);

    it(`${locale}: has exactly en's keys and no empty values`, () => {
      expect(Object.keys(flat).sort()).toEqual(Object.keys(flatEn).sort());
      for (const [k, v] of Object.entries(flat)) expect(v.trim(), k).not.toBe("");
    });

    it(`${locale}: every message compiles and names en's placeholders and tags`, () => {
      for (const [k, v] of Object.entries(flat)) {
        expect(() => new IntlMessageFormat(v, locale), k).not.toThrow();
        expect(placeholders(v), k).toEqual(placeholders(flatEn[k] ?? ""));
        expect(tags(v), k).toEqual(tags(flatEn[k] ?? ""));
      }
    });

    it(`${locale}: every plural covers the categories the language needs`, () => {
      const needed = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
      for (const [k, v] of Object.entries(flat)) {
        for (const p of cardinalPlurals(new IntlMessageFormat(v, locale).getAst() as Node[])) {
          for (const cat of needed) expect(Object.keys(p.options ?? {}), `${k} lacks "${cat}"`).toContain(cat);
        }
      }
    });

    if (locale !== "en") {
      it(`${locale}: nothing is left in English`, () => {
        for (const [k, v] of Object.entries(flat)) {
          if (!SAME_IN_EVERY_LOCALE.has(k)) expect(v, k).not.toBe(flatEn[k]);
        }
      });
    }
  }

  it("deepMerge keeps English underneath a partial locale (spec D8)", () => {
    expect(deepMerge({ a: { x: "en-x", y: "en-y" }, b: "en-b" }, { a: { x: "uk-x" } })).toEqual({
      a: { x: "uk-x", y: "en-y" },
      b: "en-b",
    });
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npx vitest run src/i18n/messages.test.ts`
Expected: FAIL — `Cannot find module './messages'`.

- [ ] **Step 5: Write the loader**

Create `src/i18n/messages.ts`:

```ts
import type { AbstractIntlMessages } from "next-intl";
import { DEFAULT_LOCALE, type Locale } from "./config";

// One line per language (spec §10). Literal paths so the bundler splits them.
const LOADERS: Record<Locale, () => Promise<AbstractIntlMessages>> = {
  en: () => import("../../messages/en.json").then((m) => m.default),
  uk: () => import("../../messages/uk.json").then((m) => m.default),
};

export function deepMerge(base: AbstractIntlMessages, over: AbstractIntlMessages): AbstractIntlMessages {
  const out: AbstractIntlMessages = { ...base };
  for (const [key, value] of Object.entries(over)) {
    const under = out[key];
    out[key] =
      value && typeof value === "object" && under && typeof under === "object"
        ? deepMerge(under, value)
        : value;
  }
  return out;
}

/** The locale's messages with English underneath (spec D8): a key missing
    from uk.json renders English, never a key path. messages.test.ts keeps
    that gap at zero; this is the safety net, not the workflow. */
export async function loadMessages(locale: Locale): Promise<AbstractIntlMessages> {
  const en = await LOADERS[DEFAULT_LOCALE]();
  if (locale === DEFAULT_LOCALE) return en;
  return deepMerge(en, await LOADERS[locale]());
}
```

If `tsc` rejects the JSON module against `AbstractIntlMessages`, append `as AbstractIntlMessages` to each `.then((m) => m.default …)`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/i18n/messages.test.ts`
Expected: PASS (9 tests: 4 per locale + the merge).

- [ ] **Step 7: Cookie constants (Task 3 Step 1, pulled forward because `request.ts` imports them)**

Create `src/i18n/cookie.ts`:

```ts
import { env } from "@/env";

// The interface locale's carrier (spec §8). HttpOnly: only request.ts reads
// it; the switcher goes through the setLocale action.
export const LOCALE_COOKIE = "NEXT_LOCALE";
export const LOCALE_COOKIE_OPTIONS = {
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
  sameSite: "lax",
  httpOnly: true,
  secure: env.NEXT_PUBLIC_APP_URL.startsWith("https://"),
} as const;
```

- [ ] **Step 8: Request config and plugin**

Create `src/i18n/request.ts`:

```ts
import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { isLocale, negotiateLocale } from "./config";
import { LOCALE_COOKIE } from "./cookie";
import { loadMessages } from "./messages";

// Resolution order (spec §4): an explicit per-request locale (public surfaces
// call setRequestLocale(org.locale) — Wave 1) → the person's cookie → the
// browser's Accept-Language → English.
export default getRequestConfig(async ({ requestLocale }) => {
  const explicit = await requestLocale;
  let locale = isLocale(explicit) ? explicit : null;
  if (!locale) {
    const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
    locale = isLocale(fromCookie) ? fromCookie : negotiateLocale((await headers()).get("accept-language"));
  }
  return { locale, messages: await loadMessages(locale) };
});
```

Modify `next.config.ts` — add the import at the top and wrap the export:

```ts
import createNextIntlPlugin from "next-intl/plugin";
// …existing nextConfig unchanged…
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");
export default withNextIntl(nextConfig);
```

- [ ] **Step 9: Typed keys**

Create `src/types/next-intl.d.ts`:

```ts
import type en from "../../messages/en.json";
import type { LOCALES } from "@/i18n/config";

// Message keys and the Locale type flow from en.json and LOCALES (spec §6):
// t("auth.login.titel") is a type error, useLocale() returns Locale.
declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof LOCALES)[number];
    Messages: typeof en;
  }
}
```

- [ ] **Step 10: Typecheck and commit**

Run: `npm run typecheck`
Expected: clean.

```bash
git add messages src/i18n src/types/next-intl.d.ts next.config.ts
git commit -m "feat(i18n): en/uk messages, fallback loader, request config, typed keys, guard tests"
```

---

### Task 3: Persisting the interface locale

**Files:**
- Create: `src/i18n/actions.ts`
- Modify: `src/lib/supabase/middleware.ts:44-47` (after `getUser()`), `src/features/auth/actions.ts:70-78` (`signUp` options)
- Test: `src/i18n/actions.test.ts`; modify `src/features/auth/actions.test.ts:114-145`

**Interfaces:**
- Consumes: `isLocale`, `Locale` (Task 1); `LOCALE_COOKIE`, `LOCALE_COOKIE_OPTIONS` (Task 2 Step 7).
- Produces: `setLocale(locale: Locale): Promise<void>` server action (Task 4's switcher calls it). The proxy seeds `NEXT_LOCALE` from `user.user_metadata.locale`; `signUp` stores `user_metadata.locale`.

- [ ] **Step 1: Write the failing action test**

Create `src/i18n/actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const auth = vi.hoisted(() => ({ getUser: vi.fn(), updateUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ auth })) }));

const jar = vi.hoisted(() => new Map<string, { value: string; options?: unknown }>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => jar.get(name) && { name, value: jar.get(name)!.value },
    set: (name: string, value: string, options?: unknown) => void jar.set(name, { value, options }),
  }),
}));

const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "http://localhost:3000" } }));

import { setLocale } from "./actions";

beforeEach(() => {
  jar.clear();
  vi.clearAllMocks();
  auth.updateUser.mockResolvedValue({ error: null });
});

describe("setLocale", () => {
  it("writes the cookie and the signed-in user's metadata, then revalidates", async () => {
    auth.getUser.mockResolvedValue({ data: { user: { user_metadata: { locale: "en" } } } });
    await setLocale("uk");
    expect(jar.get("NEXT_LOCALE")?.value).toBe("uk");
    expect(jar.get("NEXT_LOCALE")?.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    expect(auth.updateUser).toHaveBeenCalledWith({ data: { locale: "uk" } });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("skips the metadata write when it already matches", async () => {
    auth.getUser.mockResolvedValue({ data: { user: { user_metadata: { locale: "uk" } } } });
    await setLocale("uk");
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(jar.get("NEXT_LOCALE")?.value).toBe("uk");
  });

  it("sets only the cookie for an anonymous visitor", async () => {
    auth.getUser.mockResolvedValue({ data: { user: null } });
    await setLocale("uk");
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(jar.get("NEXT_LOCALE")?.value).toBe("uk");
  });

  it("ignores an unknown code entirely", async () => {
    auth.getUser.mockResolvedValue({ data: { user: null } });
    await setLocale("ua" as never);
    expect(jar.has("NEXT_LOCALE")).toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("keeps the switch when the metadata write fails (traced, not thrown)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    auth.getUser.mockResolvedValue({ data: { user: { user_metadata: {} } } });
    auth.updateUser.mockResolvedValue({ error: { message: "boom" } });
    await expect(setLocale("uk")).resolves.toBeUndefined();
    expect(jar.get("NEXT_LOCALE")?.value).toBe("uk");
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/i18n/actions.test.ts`
Expected: FAIL — `Cannot find module './actions'`.

- [ ] **Step 3: Write the action**

Create `src/i18n/actions.ts`:

```ts
"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isLocale, type Locale } from "./config";
import { LOCALE_COOKIE, LOCALE_COOKIE_OPTIONS } from "./cookie";

// The one write path for the interface locale (spec §8): the cookie is what
// request.ts reads on this device; user_metadata is what the proxy seeds the
// next device from.
export async function setLocale(locale: Locale): Promise<void> {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, LOCALE_COOKIE_OPTIONS);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user && user.user_metadata?.locale !== locale) {
    const { error } = await supabase.auth.updateUser({ data: { locale } });
    // This browser already switched; a failed metadata write only costs the
    // next device its seed. Trace it, don't fail the switch.
    if (error) console.error("[i18n] updateUser locale:", error.message);
  }
  revalidatePath("/", "layout");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/i18n/actions.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Seed the cookie in the proxy**

In `src/lib/supabase/middleware.ts`, add the imports:

```ts
import { isLocale } from "@/i18n/config";
import { LOCALE_COOKIE, LOCALE_COOKIE_OPTIONS } from "@/i18n/cookie";
```

and insert this block directly after the `getUser()` call (before the `if (!user && isProtectedPath(...))` guard):

```ts
  // Interface locale (spec §8): a signed-in person whose browser has no
  // NEXT_LOCALE yet gets it from user_metadata, so a choice made on one
  // device holds on the next. Same request/response dance as setAll above,
  // so the seeded cookie reaches this request's server components too.
  const saved = user?.user_metadata?.locale;
  if (isLocale(saved) && !request.cookies.has(LOCALE_COOKIE)) {
    request.cookies.set(LOCALE_COOKIE, saved);
    const seeded = NextResponse.next({ request });
    supabaseResponse.cookies.getAll().forEach((c) => seeded.cookies.set(c));
    seeded.cookies.set(LOCALE_COOKIE, saved, LOCALE_COOKIE_OPTIONS);
    supabaseResponse = seeded;
  }
```

The redirect branch below already copies `supabaseResponse.cookies` onto the redirect, so the seed survives a bounce to `/login`.

- [ ] **Step 6: Store the locale at signup**

In `src/features/auth/actions.ts`, add `import { getLocale } from "next-intl/server";` and replace the `signUp` options object:

```ts
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/confirm`,
      data: {
        // Interface locale (spec §8): the proxy seeds a new device from it.
        locale: await getLocale(),
        // Advisory only: onboarding pre-fills from it and re-checks availability.
        ...(parsed.data.handle ? { claimed_handle: parsed.data.handle } : {}),
      },
    },
  });
```

- [ ] **Step 7: Update the signup expectations**

In `src/features/auth/actions.test.ts`, add next to the other mocks:

```ts
// The translator echoes the key: messages.test.ts owns the copy, these tests
// assert which message an action picks.
vi.mock("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => Object.assign((key: string) => key, { has: () => true }),
}));
```

Replace the three `signUp` expectations:

```ts
  it("returns sent and passes emailRedirectTo and the locale on success", async () => {
    auth.signUp.mockResolvedValue({ error: null });
    const state = await signUp({}, form({ email: "a@b.com", password: "12345678" }));
    expect(state).toEqual({ sent: true });
    expect(auth.signUp).toHaveBeenCalledWith({
      email: "a@b.com",
      password: "12345678",
      options: { emailRedirectTo: "http://localhost:3000/auth/confirm", data: { locale: "en" } },
    });
  });
```

```ts
  it("stores a claimed handle as user metadata next to the locale", async () => {
    auth.signUp.mockResolvedValue({ error: null });
    await signUp({}, form({ email: "a@b.com", password: "longenough", handle: "anna" }));
    expect(auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ data: { locale: "en", claimed_handle: "anna" } }),
      }),
    );
  });
  it("sends no handle when none was claimed", async () => {
    auth.signUp.mockResolvedValue({ error: null });
    await signUp({}, form({ email: "a@b.com", password: "longenough" }));
    const call = auth.signUp.mock.calls[0][0];
    expect(call.options.data).toEqual({ locale: "en" });
  });
```

- [ ] **Step 8: Run the auth tests**

Run: `npx vitest run src/features/auth`
Expected: PASS. (The error-copy assertions still pass here because `actions.ts` still returns English literals; Task 5 switches them to keys and updates those assertions.)

- [ ] **Step 9: Verify and commit**

Run: `npm run verify`
Expected: clean.

```bash
git add src/i18n/actions.ts src/i18n/actions.test.ts src/lib/supabase/middleware.ts src/features/auth/actions.ts src/features/auth/actions.test.ts
git commit -m "feat(i18n): setLocale action, proxy seeds NEXT_LOCALE from user_metadata, signup stores locale"
```

---

### Task 4: Providers, fonts, the switcher, Settings › Language

**Files:**
- Create: `src/i18n/locale-switcher.tsx`, `src/features/orgs/components/language-settings.tsx`
- Modify: `src/app/(auth)/layout.tsx`, `src/app/(dashboard)/layout.tsx:33-58`, `src/app/(dashboard)/settings/page.tsx:15-19`, `src/app/layout.tsx:10-13`, `src/app/(marketing)/layout.tsx:13`

**Interfaces:**
- Consumes: `setLocale` (Task 3), `LOCALES`, `LOCALE_NAMES` (Task 1), `settings.language.*` and `common.language` messages (Task 2), `SEGMENTED_NAV_CLASS` / `segmentedItemClass` from `src/components/ui/segmented.ts`.
- Produces: `LocaleSwitcher({ label: string })` client component; `LanguageSettings()` server component; both surface layouts provide next-intl context to their trees.

- [ ] **Step 1: The switcher**

Create `src/i18n/locale-switcher.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import { useLocale } from "next-intl";
import { SEGMENTED_NAV_CLASS, segmentedItemClass } from "@/components/ui/segmented";
import { LOCALES, LOCALE_NAMES } from "./config";
import { setLocale } from "./actions";

/* The one language control (Settings › Interface, the auth pages). Server
   and client agree on the locale — it is a cookie read on the server — so
   unlike the theme picker nothing waits for mount. Each button carries its
   own lang: a screen reader says "Українська" in Ukrainian. */
export function LocaleSwitcher({ label }: { label: string }) {
  const current = useLocale();
  const [pending, startTransition] = useTransition();
  return (
    <div role="radiogroup" aria-label={label} aria-busy={pending} className={SEGMENTED_NAV_CLASS}>
      {LOCALES.map((locale) => (
        <button
          key={locale}
          type="button"
          role="radio"
          lang={locale}
          aria-checked={current === locale}
          disabled={pending}
          onClick={() => startTransition(() => setLocale(locale))}
          className={segmentedItemClass(current === locale)}
        >
          {LOCALE_NAMES[locale]}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: The Settings card**

Create `src/features/orgs/components/language-settings.tsx`:

```tsx
import { getTranslations } from "next-intl/server";
import { LocaleSwitcher } from "@/i18n/locale-switcher";

/* Settings › Interface › Language: the person's admin language (spec §4).
   What clients see is the org locale, set on the Booking page (Wave 1). */
export async function LanguageSettings() {
  const t = await getTranslations("settings.language");
  return (
    <div className="bg-card flex flex-col gap-3 rounded-xl border p-4">
      <div>
        <div className="text-sm font-medium">{t("title")}</div>
        <p className="text-muted-foreground text-sm">{t("blurb")}</p>
      </div>
      <LocaleSwitcher label={t("label")} />
    </div>
  );
}
```

In `src/app/(dashboard)/settings/page.tsx`, import it and render it under the Interface heading after `<AppearanceSettings />`:

```tsx
import { LanguageSettings } from "@/features/orgs/components/language-settings";
// …
        <h2 className="text-muted-foreground text-sm font-medium">Interface</h2>
        <AppearanceSettings />
        <LanguageSettings />
```

- [ ] **Step 3: Provide context on the dashboard**

In `src/app/(dashboard)/layout.tsx`, add:

```ts
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
```

read the locale next to the other reads (`const locale = await getLocale();` after `const mode = modeOf(org);`), and wrap the returned tree:

```tsx
  return (
    // lang on the wrapper, not <html>: the root layout stays static for the
    // marketing pages until Wave 5 decides how they render (spec §3).
    <div lang={locale} className="contents">
      <NextIntlClientProvider>
        <Providers flags={flags} mode={mode}>
          {/* …AppShell exactly as before… */}
        </Providers>
      </NextIntlClientProvider>
    </div>
  );
```

- [ ] **Step 4: Provide context on the auth pages and add the switcher**

Replace `src/app/(auth)/layout.tsx`:

```tsx
import Link from "next/link";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { BookloWordmark } from "@/features/marketing/components/booklo-mark";
import { LocaleSwitcher } from "@/i18n/locale-switcher";

/* Auth is the seam between the landing and the admin: the landing's ground,
   the wordmark up top, the form sitting directly on it — no panel, a narrow
   centred column (the Linear-style auth composition). Pages render only
   their content; this shell owns the composition, and the language switch
   sits under the column (the pre-login way to pick a language). */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const [locale, t] = await Promise.all([getLocale(), getTranslations("common")]);
  return (
    <NextIntlClientProvider>
      <main lang={locale} className="flex min-h-full flex-1 flex-col items-center justify-center gap-8 p-6">
        <Link
          href="/"
          className="text-foreground focus-visible:ring-ring focus-visible:ring-offset-background rounded-sm text-[23px] outline-none focus-visible:ring-2 focus-visible:ring-offset-4"
        >
          <BookloWordmark />
        </Link>
        <div className="w-full max-w-[340px]">{children}</div>
        <LocaleSwitcher label={t("language")} />
      </main>
    </NextIntlClientProvider>
  );
}
```

- [ ] **Step 5: Cyrillic glyphs**

In `src/app/layout.tsx` and `src/app/(marketing)/layout.tsx`, change Inter's subsets from `["latin"]` to `["latin", "cyrillic"]`. Leave Outfit and Geist Mono (no Cyrillic on Google Fonts; spec §3).

- [ ] **Step 6: Run it**

Run: `npm run verify` — expected clean.
Run: `npm run dev`, open `http://localhost:3000/login` (signed out): the switcher shows "English | Українська"; clicking Українська sets the cookie and the page re-renders (the copy is still English until Task 5 — only the switch itself is under test here). Sign in, open `/settings`: the Language card sits under Interface and reflects the same choice.

- [ ] **Step 7: Commit**

```bash
git add src/i18n/locale-switcher.tsx src/features/orgs/components/language-settings.tsx "src/app/(auth)/layout.tsx" "src/app/(dashboard)/layout.tsx" "src/app/(dashboard)/settings/page.tsx" src/app/layout.tsx "src/app/(marketing)/layout.tsx"
git commit -m "feat(i18n): next-intl providers on auth + dashboard, locale switcher, Settings › Language, Cyrillic subset"
```

---

### Task 5: Pilot — the auth pages in both languages

**Files:**
- Modify: `src/features/auth/schema.ts`, `src/features/auth/actions.ts`, `src/features/auth/schema.test.ts:73`, `src/features/auth/actions.test.ts` (error assertions)
- Modify: `src/app/(auth)/login/page.tsx`, `src/app/(auth)/login/login-form.tsx`, `src/app/(auth)/signup/page.tsx`, `src/app/(auth)/signup/signup-form.tsx`, `src/app/(auth)/forgot-password/page.tsx`, `src/app/(auth)/forgot-password/forgot-password-form.tsx`, `src/app/(auth)/reset-password/page.tsx`, `src/app/(auth)/reset-password/reset-password-form.tsx`

**Interfaces:**
- Consumes: `auth.*` messages (Task 2), the `next-intl/server` mock (Task 3 Step 7).
- Produces: zod issue messages in `auth/schema.ts` are **message keys** (`errors.passwordMin`), resolved by the actions — the "translate at the boundary" rule every later wave follows.

- [ ] **Step 1: Update the tests first**

`src/features/auth/schema.test.ts` line 73:

```ts
      expect(result.error.issues[0]?.message).toBe("errors.passwordsMismatch");
```

`src/features/auth/actions.test.ts` — the translator mock echoes keys, so:

| test | old expectation | new expectation |
|---|---|---|
| sendMagicLink maps errors | `"Could not send the link. Try again shortly."` | `"errors.linkFailed"` |
| signInWithPassword bad input | `"Enter a valid email and password."` | `"errors.credentialsInvalid"` |
| signInWithPassword auth failure | `"Invalid email or password."` | `"errors.signInFailed"` |
| signUp short password | `"Password must be at least 8 characters."` | `"errors.passwordMin"` |
| signUp generic error | `"Could not create your account. Try again."` | `"errors.signUpFailed"` |
| signUp error codes | `toMatch(/data breach/)`, `toMatch(/Too many attempts/)`, generic string | `toBe("errors.passwordWeak")`, `toBe("errors.tooManyAttempts")`, `toBe("errors.signUpFailed")` |
| requestPasswordReset invalid email | `"Enter a valid email address."` | `"errors.emailInvalid"` |
| updatePassword mismatch | `"Passwords don't match."` | `"errors.passwordsMismatch"` |
| updatePassword no recovery proof | `toMatch(/reset link has expired/)` | `toBe("errors.resetExpired")` |
| updatePassword update failure | `"Could not update your password. Request a new reset link."` | `"errors.updateFailed"` |

Run: `npx vitest run src/features/auth` — expected FAIL on every row above (still English).

- [ ] **Step 2: Schema messages become keys**

In `src/features/auth/schema.ts`:

```ts
// Issue messages are message keys under `auth` (spec §5: translate at the
// boundary — the action resolves them with t()). Never English here.
export const signUpSchema = z.object({
  email: z.string().email("errors.emailInvalid"),
  password: z.string().min(8, "errors.passwordMin"),
  handle: z.preprocess(
    (v) => (v == null || (typeof v === "string" && v.trim() === "") ? undefined : v),
    z
      .string()
      .regex(HANDLE_RE, "errors.handleInvalid")
      .refine((h) => !isReservedHandle(h), "errors.handleUnavailable")
      .optional(),
  ),
});

export const newPasswordSchema = z
  .object({
    password: z.string().min(8, "errors.passwordMin"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: "errors.passwordsMismatch",
    path: ["confirm"],
  });
```

(`emailSchema` and `signInSchema` carry no messages; the actions pick the key.)

- [ ] **Step 3: Actions resolve keys**

In `src/features/auth/actions.ts`, add `import { getLocale, getTranslations } from "next-intl/server";` (replacing the `getLocale` import from Task 3) and this helper above the actions:

```ts
import type en from "../../../messages/en.json";

type AuthT = Awaited<ReturnType<typeof getTranslations<"auth">>>;
type AuthErrorKey = `errors.${keyof (typeof en)["auth"]["errors"]}`;

// Zod issue messages are keys (schema.ts). An issue we did not write a key
// for falls back to the action's generic message. t.has() is the runtime
// check; the cast is the one place a checked string meets the typed t.
function issueMessage(t: AuthT, issue: { message: string } | undefined, fallback: AuthErrorKey): string {
  const key = issue?.message;
  return key && t.has(key) ? t(key as AuthErrorKey) : t(fallback);
}
```

Then replace every English return:

```ts
export async function sendMagicLink(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const t = await getTranslations("auth");
  const parsed = emailSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { error: t("errors.emailInvalid") };
  // …unchanged…
  if (error) return { error: t("errors.linkFailed") };
  return { sent: true };
}

export async function signInWithPassword(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const t = await getTranslations("auth");
  // …
  if (!parsed.success) return { error: t("errors.credentialsInvalid") };
  // …
  if (error) return { error: t("errors.signInFailed") };
  redirect(afterLogin(formData.get("next")));
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const t = await getTranslations("auth");
  // …
  if (!parsed.success) return { error: issueMessage(t, parsed.error.issues[0], "errors.credentialsInvalid") };
  // …signUp call from Task 3…
  if (error) {
    if (error.code === "weak_password") return { error: t("errors.passwordWeak") };
    if (error.code === "over_request_rate_limit" || error.code === "over_email_send_rate_limit") {
      return { error: t("errors.tooManyAttempts") };
    }
    return { error: t("errors.signUpFailed") };
  }
  return { sent: true };
}

export async function requestPasswordReset(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const t = await getTranslations("auth");
  const parsed = emailSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { error: t("errors.emailInvalid") };
  // …unchanged…
}

export async function updatePassword(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const t = await getTranslations("auth");
  // …
  if (!parsed.success) return { error: issueMessage(t, parsed.error.issues[0], "errors.passwordInvalid") };
  // …
  if (!jar.get(RECOVERY_COOKIE)) return { error: t("errors.resetExpired") };
  // …
  if (error) return { error: t("errors.updateFailed") };
  jar.delete(RECOVERY_COOKIE);
  redirect("/bookings");
}
```

Keep every comment that explains a security choice (generic copy, anti-enumeration, the recovery proof) where it is.

Run: `npx vitest run src/features/auth` — expected PASS.

- [ ] **Step 4: Login**

`src/app/(auth)/login/page.tsx`:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getOptionalUser } from "@/lib/auth/session";
import { afterLogin, safeNextPath } from "@/lib/auth/next-path";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  // Already signed in: nothing to do here (a re-opened confirmation link,
  // a bookmark). Straight to where they were headed.
  if (await getOptionalUser()) redirect(afterLogin(next));
  const nextPath = safeNextPath(next);
  const t = await getTranslations("auth.login");

  return (
    <div>
      {/* The wordmark above already says Booklo — the heading doesn't repeat it. */}
      <h1 className="mb-6 text-center text-lg font-semibold tracking-tight">{t("title")}</h1>
      {error === "auth" ? (
        <p className="text-destructive mb-4 text-center text-sm">{t("expiredLink")}</p>
      ) : null}
      <LoginForm next={nextPath} />
      <p className="text-muted-foreground mt-7 text-center text-sm">
        {t.rich("noAccount", {
          link: (chunks) => (
            <Link href="/signup" className="text-foreground hover:underline">
              {chunks}
            </Link>
          ),
        })}
      </p>
    </div>
  );
}
```

`src/app/(auth)/login/login-form.tsx` — add `import { useTranslations } from "next-intl";`, then in `PasswordForm`:

```tsx
function PasswordForm({ onSwitch, next }: { onSwitch: () => void; next: string | null }) {
  const [state, action, pending] = useActionState(signInWithPassword, initial);
  const t = useTranslations("auth");

  return (
    <form action={action} className="flex flex-col gap-4">
      {/* Validated again server-side (afterLogin) — this is only a carrier. */}
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">{t("email")}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder={t("emailPlaceholder")}
          className="h-11 rounded-xl"
        />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">{t("password")}</Label>
          <Link href="/forgot-password" className="text-muted-foreground text-xs hover:underline">
            {t("login.forgot")}
          </Link>
        </div>
        <PasswordInput id="password" name="password" required autoComplete="current-password" className="h-11 rounded-xl" />
      </div>
      {state.error ? <p className="text-destructive text-sm">{state.error}</p> : null}
      <Button type="submit" disabled={pending} className="h-11">
        {pending ? t("login.submitting") : t("login.submit")}
      </Button>
      <Button type="button" variant="outline" onClick={onSwitch} className="h-11">
        {t("login.useMagic")}
      </Button>
    </form>
  );
}
```

and in `MagicLinkForm`: `const t = useTranslations("auth");`, the sent state renders `{t("login.magicSent")}`, the label `{t("email")}`, placeholder `{t("emailPlaceholder")}`, the submit `{pending ? t("login.sending") : t("login.sendMagic")}`, the switch `{t("login.usePassword")}`.

- [ ] **Step 5: Signup**

`src/app/(auth)/signup/page.tsx` — add `import { getTranslations } from "next-intl/server";`, `const t = await getTranslations("auth.signup");` after `host`, and render:

```tsx
      <h1 className="mb-1.5 text-center text-lg font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-muted-foreground mb-6 text-center text-sm">{t("blurb")}</p>
      <SignupForm handle={handle} host={host} />
      <p className="text-muted-foreground mt-7 text-center text-sm">
        {t.rich("haveAccount", {
          link: (chunks) => (
            <Link href="/login" className="text-foreground hover:underline">
              {chunks}
            </Link>
          ),
        })}
      </p>
```

`src/app/(auth)/signup/signup-form.tsx` — `const t = useTranslations("auth");` after `claimed`, then:

```tsx
  if (state.sent) {
    return (
      <p className="text-center text-sm">
        {claimed ? t("signup.sentClaimed", { claimed }) : t("signup.sent")}
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      {claimed ? (
        <p className="bg-muted text-muted-foreground rounded-lg px-3 py-2 text-center font-mono text-xs">
          {t.rich("signup.claiming", {
            claimed,
            handle: (chunks) => <span className="text-foreground">{chunks}</span>,
          })}
        </p>
      ) : null}
      {handle ? <input type="hidden" name="handle" value={handle} /> : null}
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">{t("email")}</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" placeholder={t("emailPlaceholder")} className="h-11 rounded-xl" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">{t("password")}</Label>
        <PasswordInput id="password" name="password" required minLength={8} autoComplete="new-password" className="h-11 rounded-xl" />
        <p className="text-muted-foreground text-xs">{t("passwordHint")}</p>
      </div>
      {state.error ? <p className="text-destructive text-sm">{state.error}</p> : null}
      <Button type="submit" disabled={pending} className="h-11">
        {pending ? t("signup.submitting") : t("signup.submit")}
      </Button>
    </form>
  );
```

- [ ] **Step 6: Forgot password**

`src/app/(auth)/forgot-password/page.tsx` — `const t = await getTranslations("auth.forgot");` and render `t("title")`, `t("blurb")`, `t("expired")` in the expired paragraph, and the back link's text `t("back")`.

`src/app/(auth)/forgot-password/forgot-password-form.tsx` — `const t = useTranslations("auth");`; sent state `{t("forgot.sent")}`; label `{t("email")}`; placeholder `{t("emailPlaceholder")}`; submit `{pending ? t("forgot.sending") : t("forgot.submit")}`.

- [ ] **Step 7: Reset password**

`src/app/(auth)/reset-password/page.tsx` — `const t = await getTranslations("auth.reset");` after the recovery-cookie check; render `t("title")` and `t("blurb")`.

`src/app/(auth)/reset-password/reset-password-form.tsx` — `const t = useTranslations("auth");`; labels `{t("reset.newPassword")}` and `{t("reset.confirm")}`; hint `{t("passwordHint")}`; submit `{pending ? t("reset.saving") : t("reset.submit")}`.

- [ ] **Step 8: Verify both languages in the browser**

Run: `npm run verify` — expected clean.
Run: `npm run dev`. On `http://localhost:3000/login`, `/signup`, `/signup?handle=anna-studio`, `/forgot-password`: every word switches with the switcher, including the linked sentences and the claimed-handle line. Submit bad input on each form in Ukrainian: the error is Ukrainian. Sign in with a Ukrainian cookie, then delete the cookie in devtools and reload `/settings`: the proxy restores Ukrainian from `user_metadata`.

- [ ] **Step 9: Commit**

```bash
git add src/features/auth "src/app/(auth)"
git commit -m "feat(i18n): auth pages in English and Ukrainian — the pilot surface"
```

---

### Task 6: Lint ratchet and the glossary

**Files:**
- Modify: `eslint.config.mjs`
- Create: `messages/GLOSSARY.md`

**Interfaces:**
- Produces: the `react/jsx-no-literals` override block later waves append directories to; the glossary later waves' translations follow.

- [ ] **Step 1: See the rule catch a literal**

Temporarily add `<p>Hello</p>` inside `src/app/(auth)/login/page.tsx`, then apply Step 2 and run `npm run lint` — expected: one error naming that line. Remove the line.

- [ ] **Step 2: The ratchet**

In `eslint.config.mjs`, append before `]);`:

```js
  // i18n ratchet (spec 2026-09-02 §6): directories already moved to
  // messages/*.json must not grow new hardcoded JSX text. Each wave appends
  // the directories it migrated. Props are exempt (className would drown the
  // rule); reviews cover placeholder/aria strings.
  {
    files: ["src/app/(auth)/**/*.tsx", "src/features/auth/**/*.tsx", "src/i18n/**/*.tsx"],
    rules: {
      "react/jsx-no-literals": [
        "error",
        { noStrings: true, ignoreProps: true, allowedStrings: [" ", "…", "·", "—", "→"] },
      ],
    },
  },
```

Run: `npm run lint` — expected clean on the migrated files.

- [ ] **Step 3: The glossary**

Create `messages/GLOSSARY.md` with the table and style rules from spec §7 verbatim, plus this header:

```markdown
# Translation glossary and style

Source language: English (`messages/en.json`). Every other language is a
full translation of it; `src/i18n/messages.test.ts` refuses a partial one.

Before drafting a language: read the term table, then the style notes.
A term missing here is added here first, then used.

## Terms

| en | uk | note |
|---|---|---|
| appointment | запис | a time booked with a person |
| service | послуга | |
| space | простір | rooms, studios and gear alike (H5a ruling) |
| unit (of a space) | одиниця | the individual room or item |
| booking | бронювання | |
| request (pending approval) | запит | |
| client | клієнт | |
| team member | учасник команди | never "персонал" |
| the provider (you) | ви / ваш бізнес | never "провайдер" |
| availability, hours | графік, робочі години | |
| time / slot | час | never "слот" in client-facing copy |
| stay (nights) | проживання | |
| check-in / check-out | заїзд / виїзд | |
| reschedule / cancel / confirm | перенести / скасувати / підтвердити | |
| deposit | завдаток | |
| widget / booking page | віджет / сторінка бронювання | |
| embed | код для сайту | the noun; the verb is "вбудувати" |
| handle (page address) | адреса сторінки | |
| Free / Pro | Free / Pro | plan names stay |
| Booklo | Booklo | |

## Style — uk

- Formal **ви**, lowercase in running text.
- Buttons are imperatives: "Зберегти", "Скасувати", "Увійти".
- No exclamation marks. Sentence case. One idea per sentence.
- Typographic apostrophe `’` inside words (з’являвся), em dash `—` with spaces.
- Forbidden words (the `FORBIDDEN_COPY` guard, per locale): оренда, офер, пропустити.

## Never translated

"Booklo", plan names, language names in the switcher (`LOCALE_NAMES`),
handles, URLs, ISO codes, the `you@company.com` placeholder.
```

- [ ] **Step 4: Commit**

```bash
git add eslint.config.mjs messages/GLOSSARY.md
git commit -m "chore(i18n): jsx-no-literals ratchet on migrated dirs, translation glossary"
```

---

### Task 7: QA, graph, PR

**Files:**
- Modify: `graphify-out/` (generated)

- [ ] **Step 1: Full verify**

Run: `npm run verify` — expected clean (lint, typecheck, all unit tests including the four new test files).

- [ ] **Step 2: Screenshots in both languages**

With `npm run dev` on `localhost:3000`, use Playwright (scripted from the npx cache, per the QA lesson) to capture `/login`, `/signup?handle=anna-studio`, `/forgot-password` at 1440×900 and 390×844, once per language (click the switcher between runs — the cookie is HttpOnly, so it cannot be set from page script). Check: no button or link wraps or clips in Ukrainian; the switcher sits centred under the column; `<main lang>` reads `uk`.

- [ ] **Step 3: Cross-device seed**

Signed in with Ukrainian chosen: open a fresh incognito window, sign in — the dashboard shell is still English (Wave 3) but `/settings` shows Українська selected and `document.querySelector("[lang]").lang === "uk"` on the dashboard wrapper.

- [ ] **Step 4: Update the graph**

Run: `graphify update .`

- [ ] **Step 5: Open the PR**

```bash
git push -u origin feat/i18n-foundation
gh pr create --title "feat(i18n): foundation — next-intl, locale cookie + user_metadata, guards, auth pages in uk" --body "$(cat <<'EOF'
Wave 0 of docs/superpowers/specs/2026-09-02-i18n-design.md.

- next-intl without URL routing; locale = requestLocale → NEXT_LOCALE cookie → Accept-Language → en
- messages/en.json + uk.json with English deep-merged underneath (D8); guard tests: parity, ICU, placeholders/tags, plural categories per Intl.PluralRules, untranslated detector
- typed keys via AppConfig
- setLocale action (cookie + user_metadata), proxy seeds the cookie on a new device, signup stores the locale
- LocaleSwitcher on the auth pages and Settings › Interface › Language
- Pilot: the four auth pages and their actions fully in en + uk
- jsx-no-literals ratchet on the migrated directories; messages/GLOSSARY.md

No migration. Root layout untouched except Inter's cyrillic subset (marketing stays static until Wave 5).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01RDSMQQqqYie1pNEpoLjJ5t
EOF
)"
```
