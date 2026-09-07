import { z } from "zod";

const text = z.string().trim().max(200).transform((s) => (s === "" ? undefined : s)).optional();
const link = z.string().trim().max(500).transform((s) => (s === "" ? undefined : s)).optional()
  .refine((s) => s === undefined || /^https?:\/\/\S+$/i.test(s), { message: "http(s) link" });

// S2 (spec §Data model → orgs.legal): what the public footer prints. All
// optional; P24's website requirements are the studio's to meet, the fields
// are here so it can.
export const legalSchema = z.object({
  legalName: text, address: text, taxId: text, regNo: text,
  termsUrl: link, privacyUrl: link, refundUrl: link,
}).transform((o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Legal);
export type Legal = Partial<Record<"legalName" | "address" | "taxId" | "regNo" | "termsUrl" | "privacyUrl" | "refundUrl", string>>;

/** The jsonb as stored → a Legal, tolerating anything (a bad row renders no footer). */
export function parseLegal(raw: unknown): Legal {
  const r = legalSchema.safeParse(raw ?? {});
  return r.success ? r.data : {};
}

export const HOLD_OPTIONS = [30, 60, 180, 1440] as const;
export const LEGAL_COUNTRIES = ["PL", "DE", "CZ", "SK", "LT", "LV", "EE", "AT", "NL", "BE", "FR", "ES", "IT", "PT", "IE", "GB", "SE", "DK", "FI", "NO"] as const;
