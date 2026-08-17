import "server-only";

import { createAnonServerClient } from "@/lib/supabase/anon-server";
import { env } from "@/env";
import { tokenLimiter } from "./rate-limit";

export type ResolveBookingResult =
  | { status: "not_found" }
  | { status: "rate_limited" }
  | {
      status: "ok";
      booking: {
        id: string;
        status: string;
        startsAt: Date;
        endsAt: Date;
        serviceName: string;
        orgName: string;
        orgTimezone: string;
        orgId: string;
        // Rentals R1: a booking is EITHER an appointment (serviceId set) or a
        // rental stay (rentalUnitId + rangeMode set) — never both.
        serviceId: string | null;
        rentalUnitId: string | null;
        rangeMode: "nights" | "days" | null;
      };
    };

export async function resolveBookingToken(
  token: string,
  clientKey: string,
): Promise<ResolveBookingResult> {
  if (!tokenLimiter.allow(`${clientKey}:${token.slice(0, 8)}`)) {
    return { status: "rate_limited" };
  }
  if (token.length < 20 || token.length > 200) return { status: "not_found" };
  const anon = createAnonServerClient();
  const { data, error } = await anon.rpc("resolve_booking_token", { p_token: token });
  if (error) {
    console.error("[booking] resolve:", error.code || "rpc error");
    return { status: "not_found" };
  }
  const row = (data as Array<{
    booking_id: string;
    booking_status: string;
    starts_at: string;
    ends_at: string;
    service_name: string;
    org_name: string;
    org_timezone: string;
    org_id: string;
    service_id: string | null;
    rental_unit_id: string | null;
    range_mode: "nights" | "days" | null;
  }> | null)?.[0];
  if (!row) return { status: "not_found" };
  return {
    status: "ok",
    booking: {
      id: row.booking_id,
      status: row.booking_status,
      startsAt: new Date(row.starts_at),
      endsAt: new Date(row.ends_at),
      serviceName: row.service_name,
      orgName: row.org_name,
      orgTimezone: row.org_timezone,
      orgId: row.org_id,
      serviceId: row.service_id,
      rentalUnitId: row.rental_unit_id,
      rangeMode: row.range_mode,
    },
  };
}

export function buildBookingManageUrl(token: string): string {
  return `${env.NEXT_PUBLIC_APP_URL}/booking/${token}`;
}
