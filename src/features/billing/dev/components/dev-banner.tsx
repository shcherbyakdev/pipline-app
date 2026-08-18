/* The masthead of every dev-billing page. Two jobs: say loudly that this is
   not a payment page, and carry the test cards so a scenario walk never needs
   the plan document open beside it (Global Constraints). */

const TEST_CARDS: Array<{ number: string; effect: string }> = [
  { number: "4242 4242 4242 4242", effect: "succeeds" },
  { number: "4000 0000 0000 0002", effect: "declined" },
  { number: "4000 0000 0000 9995", effect: "insufficient funds" },
  { number: "4000 0000 0000 0341", effect: "attaches, first charge fails → past_due" },
];

export function DevBanner() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
      <p className="text-sm font-semibold">Booklo dev billing — emulator, no real charges.</p>
      <ul className="flex flex-col gap-0.5 text-xs">
        {TEST_CARDS.map((card) => (
          <li key={card.number} className="text-muted-foreground">
            <code className="font-mono text-foreground">{card.number}</code> — {card.effect}
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground text-xs">
        Any other Luhn-valid 16-digit number succeeds. Expiry must be a future MM/YY, CVC 3–4 digits;
        anything else is rejected as invalid.
      </p>
    </div>
  );
}
