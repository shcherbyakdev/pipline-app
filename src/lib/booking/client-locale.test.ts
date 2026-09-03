import { describe, it, expect, vi } from "vitest";

// The stamp half of this module reaches for the request (publicLocale) and
// the admin client; clientMailCopy needs neither. Same discipline as
// reminders.test.ts: mock the import graph, test the logic.
vi.mock("@/i18n/public", () => ({ publicLocale: async () => "en" }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => null }));

import { clientMailCopy } from "./client-locale";

const ORG = { locale: "uk", timezone: "Europe/Kyiv" };
const ROW = {
  starts_at: "2027-03-04T09:00:00Z",
  ends_at: "2027-03-04T10:00:00Z",
  rental_unit_id: null,
  services: { name: "Haircut" },
};

describe("clientMailCopy (the client's half of a lifecycle mail)", () => {
  it("renders in the language the client booked in, not the org's", async () => {
    const forClient = await clientMailCopy({ ...ROW, locale: "en" }, ORG);
    const forOrg = await clientMailCopy({ ...ROW, locale: "uk" }, ORG);
    // Same booking, same instant, two languages — the whole point of 0072.
    expect(forClient.intlLocale).toBe("en-GB");
    expect(forOrg.intlLocale).toBe("uk");
    expect(forClient.whenLine).not.toBe(forOrg.whenLine);
  });

  it("falls back to the org for a row with no locale of its own", async () => {
    // Every booking made before 0072, and every admin-made one.
    const legacy = await clientMailCopy({ ...ROW, locale: null }, ORG);
    expect(legacy.intlLocale).toBe("uk");
  });

  it("ignores a locale the product does not speak", async () => {
    const bogus = await clientMailCopy({ ...ROW, locale: "ua" }, ORG);
    expect(bogus.intlLocale).toBe("en-GB");
  });

  it("titles the booking in the same language as the when-line", async () => {
    const unnamed = { ...ROW, services: null, locale: "uk" };
    const uk = await clientMailCopy(unnamed, ORG);
    const en = await clientMailCopy({ ...unnamed, locale: "en" }, ORG);
    // The fallback word is emails.appointment — translated, so the two differ.
    expect(uk.serviceName).not.toBe(en.serviceName);
    // A named service is the org's own data and never translated.
    expect((await clientMailCopy({ ...ROW, locale: "uk" }, ORG)).serviceName).toBe("Haircut");
  });
});
