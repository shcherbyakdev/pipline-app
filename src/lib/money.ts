// Client-safe money formatting. All amounts are integer cents; the org's
// currency (orgs.currency, 0058 CHECK) picks the display locale.
export const CURRENCIES = ["PLN", "EUR", "USD", "GBP", "CZK"] as const;
export type Currency = (typeof CURRENCIES)[number];

const LOCALE: Record<Currency, string> = {
  PLN: "pl-PL", EUR: "de-DE", USD: "en-US", GBP: "en-GB", CZK: "cs-CZ",
};

export function formatMoney(cents: number, currency: string): string {
  const locale = LOCALE[currency as Currency] ?? "en";
  const fractional = cents % 100 !== 0;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: fractional ? 2 : 0,
      maximumFractionDigits: fractional ? 2 : 0,
    }).format(cents / 100);
  } catch {
    // Unknown ISO code: still show the number rather than crash a flow.
    return `${(cents / 100).toFixed(fractional ? 2 : 0)} ${currency}`;
  }
}
