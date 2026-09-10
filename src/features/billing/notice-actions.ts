"use server";

import { cookies } from "next/headers";
import { env } from "@/env";
import { getCurrentOrg } from "@/lib/auth/session";
import {
  isNoticeDismissed,
  noticeToken,
  PLAN_NOTICE_COOKIE,
  PLAN_NOTICE_MAX_AGE,
  withNoticeDismissed,
} from "./plan-notice";

/** Hide one plan notice for this browser. The token comes from the client,
    so it is rebuilt here from the caller's own org id and only the kind and
    signature are taken on trust — a token for another org's banner can't be
    written. Setting a cookie in a server function re-renders the page, so
    the notice stays gone without a refresh. */
export async function dismissPlanNotice(kind: string, signature: string): Promise<void> {
  const org = await getCurrentOrg();
  if (!org || !/^[\w-]{1,32}$/.test(kind) || !/^[\w-]{1,32}$/.test(signature)) return;
  const jar = await cookies();
  const current = jar.get(PLAN_NOTICE_COOKIE)?.value;
  const token = noticeToken(org.id, kind, signature);
  if (isNoticeDismissed(current, token)) return;
  jar.set(PLAN_NOTICE_COOKIE, withNoticeDismissed(current, token), {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NEXT_PUBLIC_APP_URL.startsWith("https://"),
    path: "/",
    maxAge: PLAN_NOTICE_MAX_AGE,
  });
}
