import { after, type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { googleConfigured } from "@/features/calendar-sync/connections";
import { runInbound, verifyWebhookToken } from "@/features/calendar-sync/inbound-run";

/* POST /api/google/webhook — Google's push notification for a channel
   opened by ensureWatch (spec v2 decision 19). The body is empty; the
   headers name the channel and carry the token we set when opening it.
   Nothing is trusted from the headers except as a lookup key + HMAC check;
   the actual change is read back from Google by the poll. Always 200 —
   Google retries non-2xx, and an unknown channel is one we stopped. */
export async function POST(request: NextRequest) {
  if (!googleConfigured()) return new NextResponse(null, { status: 404 });
  const state = request.headers.get("x-goog-resource-state");
  const channelId = request.headers.get("x-goog-channel-id");
  const token = request.headers.get("x-goog-channel-token");
  // "sync" is the hello Google sends when a channel opens.
  if (state === "sync" || !channelId) return new NextResponse(null, { status: 200 });

  const { data } = await createAdminClient().from("calendar_connections").select("id").eq("watch_channel_id", channelId).maybeSingle();
  if (!data || !verifyWebhookToken(data.id, token)) return new NextResponse(null, { status: 200 });

  after(async () => {
    try {
      await runInbound({ connectionId: data.id });
    } catch (error) {
      console.error("[calendar] webhook poll failed:", error);
    }
  });
  return new NextResponse(null, { status: 200 });
}
