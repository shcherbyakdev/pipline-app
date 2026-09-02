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
