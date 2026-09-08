import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/env";
import { clientKeyFrom } from "@/lib/tokens";
import { resolveBookingToken } from "@/lib/tokens/booking";
import { getBookingLocale } from "@/lib/booking/public";
import { startCheckout } from "@/features/payments/checkout";

// The one door to Checkout (spec ruling 8): the widget panel, the manage page
// and the pay-by mail all link here. Anything that cannot pay lands on the
// manage page, which explains why. 303s throughout — a GET must never be
// re-played into a second session by a refresh.
export async function GET(request: NextRequest, ctx: RouteContext<"/booking/[token]/pay">) {
  const { token } = await ctx.params;
  const manage = new URL(`/booking/${token}`, env.NEXT_PUBLIC_APP_URL);
  const lang = request.nextUrl.searchParams.get("lang");
  if (lang) manage.searchParams.set("lang", lang);
  const result = await resolveBookingToken(token, clientKeyFrom(request.headers));
  if (result.status !== "ok") return NextResponse.redirect(manage, 303);
  const b = result.booking;
  // Holds pay their deposit, confirmed bookings their balance (S7); whether
  // either is actually payable — a lapsed hold, a settled booking — is
  // startCheckout's call, and every error below lands on the manage page.
  if (b.status !== "pending_payment" && b.status !== "confirmed") {
    return NextResponse.redirect(manage, 303);
  }
  const success = new URL(manage);
  success.searchParams.set("paid", "1");
  const started = await startCheckout(b.id, {
    successUrl: success.toString(),
    cancelUrl: manage.toString(),
    locale: lang ?? (await getBookingLocale(b.id)),
  });
  if ("error" in started) {
    // A lapsed hold is not a failed payment: the manage page's own status
    // line already explains it, so that case gets no `pay=failed` banner.
    if (started.error !== "expired") manage.searchParams.set("pay", "failed");
    return NextResponse.redirect(manage, 303);
  }
  return NextResponse.redirect(started.url, 303);
}
