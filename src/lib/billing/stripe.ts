import "server-only";
import type { BillingProvider } from "./provider";

// Placeholder — Task 6 replaces this file wholesale with the real Stripe
// adapter. Exists now only so provider.ts's static top-level import of
// "./stripe" resolves.
export function stripeProvider(): BillingProvider {
  throw new Error("stripe adapter not implemented yet (Task 6)");
}
