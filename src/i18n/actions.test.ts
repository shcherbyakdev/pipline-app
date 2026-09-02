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
