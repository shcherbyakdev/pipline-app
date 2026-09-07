// S2: a hold is live until the drain flips it (stored deadline, unlike the
// computed lapse of a pending request in requests.ts). Between the deadline
// and the next drain tick the row still blocks its slot — the UI says
// "awaiting payment" either way; only the actions differ.
export function isLiveHold(
  b: { status: string; holdExpiresAt: string | null },
  now: Date,
): boolean {
  return (
    b.status === "pending_payment" &&
    !!b.holdExpiresAt &&
    new Date(b.holdExpiresAt).getTime() > now.getTime()
  );
}

/** "Reserved until 14:32" for a hold expiring today, with the day when not. */
export function holdLabel(
  b: { holdExpiresAt: string | null },
  timeZone: string,
  intlLocale: string,
  // Narrowed to the keys used here so next-intl's typed translator (whose
  // own key parameter is a literal union) is assignable to it.
  t: (key: "hold.until", values: { time: string }) => string,
): string | null {
  if (!b.holdExpiresAt) return null;
  const d = new Date(b.holdExpiresAt);
  const day = new Intl.DateTimeFormat(intlLocale, { timeZone, dateStyle: "short" });
  const sameDay = day.format(d) === day.format(new Date());
  const time = new Intl.DateTimeFormat(intlLocale, {
    timeZone,
    ...(sameDay ? {} : { weekday: "short", day: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
  return t("hold.until", { time });
}

/** The word for a card that holds its slot without being confirmed: a pending
    request, or a hold waiting on payment (0062, 0079). Null for everything
    else — a confirmed card says nothing extra. */
export function ghostWord(
  status: string,
  t: (key: "status.pending" | "status.pendingPayment") => string,
): string | null {
  return status === "pending"
    ? t("status.pending")
    : status === "pending_payment"
      ? t("status.pendingPayment")
      : null;
}
