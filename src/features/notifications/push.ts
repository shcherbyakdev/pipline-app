import "server-only";

import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/env";
import { createAdminClient } from "@/lib/supabase/admin";

/* Web Push (spec 2026-09-05 §2, §5): the browser standard, VAPID-signed,
   no vendor. A member enables a browser on /notifications; the browser hands
   us an endpoint + keys that we store (push_subscriptions, 0075) and later
   post encrypted payloads to. `web-push` does the RFC 8291 encryption and
   the VAPID JWT — the one dependency this feature adds. */

export type PushPayload = {
  title: string;
  body: string;
  /** Where a tap lands (absolute or app-relative; the worker resolves it). */
  url: string;
  /** Same tag = the newer notification replaces the older one on the device. */
  tag: string;
};

/** All three VAPID values, or the channel is off. The page reads this to
    say "not set up"; the seam reads it to skip push without logging. */
export function pushConfigured(): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
}

export function vapidPublicKey(): string | null {
  return pushConfigured() ? env.VAPID_PUBLIC_KEY! : null;
}

type SubscriptionRow = { id: string; endpoint: string; p256dh: string; auth: string };

export type PushSender = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  options: { TTL: number; vapidDetails: { subject: string; publicKey: string; privateKey: string } },
) => Promise<unknown>;

export type PushDeps = { db?: SupabaseClient; send?: PushSender };

/** Deliver one payload to every device a user enabled. Best-effort, never
    throws: a device that the push service reports gone (404/410 — the
    person revoked permission or the browser rotated the endpoint) is
    deleted so it is not retried forever; any other failure is logged and
    the row kept (transient). TTL one day: a "new booking" ping older than
    that is stale, the app itself is the record. */
export async function sendPush(
  userId: string,
  payload: PushPayload,
  deps: PushDeps = {},
): Promise<{ sent: number; dropped: number; failed: number }> {
  const summary = { sent: 0, dropped: 0, failed: 0 };
  if (!pushConfigured()) return summary;
  const db = deps.db ?? createAdminClient();
  const send: PushSender = deps.send ?? ((sub, body, opts) => webpush.sendNotification(sub, body, opts));
  const vapidDetails = { subject: env.VAPID_SUBJECT!, publicKey: env.VAPID_PUBLIC_KEY!, privateKey: env.VAPID_PRIVATE_KEY! };

  let rows: SubscriptionRow[] = [];
  try {
    const { data, error } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", userId);
    if (error) throw error;
    rows = (data ?? []) as SubscriptionRow[];
  } catch (error) {
    console.error("[notifications] push subscriptions read failed:", error);
    return summary;
  }

  const body = JSON.stringify(payload);
  for (const row of rows) {
    try {
      await send({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, body, { TTL: 86_400, vapidDetails });
      summary.sent += 1;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        summary.dropped += 1;
        const { error: deleteError } = await db.from("push_subscriptions").delete().eq("id", row.id);
        if (deleteError) console.error("[notifications] gone subscription not deleted:", deleteError);
      } else {
        summary.failed += 1;
        console.error("[notifications] push send failed:", error);
      }
    }
  }
  return summary;
}
