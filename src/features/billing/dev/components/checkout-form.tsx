import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fakeCheckout } from "../actions";

/* What the real provider's hosted checkout would show, minus the parts that
   only matter when money moves. The offer (plan, interval, org, where to come
   back to) rides in hidden fields rather than being re-derived server-side:
   this form is the emulator's stand-in for a Stripe Checkout Session, and a
   session carries its own terms. The guard still re-checks `org` against the
   session — hidden fields are client input. */

const CHECKOUT_ERRORS: Record<string, string> = {
  declined: "Card declined. Try 4242 4242 4242 4242 to succeed.",
  insufficient_funds: "Insufficient funds on that card.",
  invalid: "Check the number (16 digits), expiry (future MM/YY) and CVC (3–4 digits).",
};

/** The line for `?error=`; null for a missing or unknown code. */
export function checkoutErrorMessage(code: string | null): string | null {
  return code && code in CHECKOUT_ERRORS ? CHECKOUT_ERRORS[code] : null;
}

export function CheckoutForm({
  org, plan, interval, returnTo, cancelTo, customer, payLabel, error,
}: {
  org: string;
  plan: string;
  interval: string;
  /** Where a SUCCESSFUL purchase lands (carries `checkout=success`). */
  returnTo: string;
  /** Where "Cancel" goes — the same page without the success markers. */
  cancelTo: string;
  customer?: string;
  /** What the button says it charges today, e.g. "$12" or "$108". */
  payLabel: string;
  error?: string;
}) {
  const message = checkoutErrorMessage(error ?? null);
  return (
    <form action={fakeCheckout} className="flex flex-col gap-4">
      <input type="hidden" name="org" value={org} />
      <input type="hidden" name="plan" value={plan} />
      <input type="hidden" name="interval" value={interval} />
      <input type="hidden" name="return" value={returnTo} />
      {customer ? <input type="hidden" name="customer" value={customer} /> : null}

      {message ? (
        <p role="alert" className="text-destructive text-sm">
          {message}
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="number">Card number</Label>
        {/* No default: which card is chosen IS the scenario. autoComplete off
            so the browser never offers a real card on a page that fakes one. */}
        <Input
          id="number" name="number" inputMode="numeric" autoComplete="off"
          placeholder="4242 4242 4242 4242" required
        />
      </div>

      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="exp">Expiry</Label>
          {/* Prefilled: the expiry and CVC are noise in every scenario — only
              the number selects an outcome. */}
          <Input id="exp" name="exp" autoComplete="off" placeholder="MM/YY" defaultValue="12/34" required />
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="cvc">CVC</Label>
          <Input id="cvc" name="cvc" inputMode="numeric" autoComplete="off" placeholder="123" defaultValue="123" required />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Name on card</Label>
        <Input id="name" name="name" autoComplete="off" placeholder="Ada Lovelace" />
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit">Pay {payLabel}</Button>
        {/* Plain anchor: `cancelTo` may be an absolute URL back into the app,
            and leaving the emulator should be a full navigation. */}
        <a href={cancelTo} className="text-muted-foreground text-sm underline underline-offset-4">
          Cancel
        </a>
      </div>
    </form>
  );
}
