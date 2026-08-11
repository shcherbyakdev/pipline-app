import "server-only";
import type { EmailTransport } from "./transport";

// Bare fetch on purpose — the Resend surface we use is one POST, and the
// Idempotency-Key header (24h dedupe window) is the second half of the
// drain's double-send defence. No SDK, no dependency.
export function resendTransport(apiKey: string, from: string): EmailTransport {
  return {
    async send(msg) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": msg.idempotencyKey,
        },
        body: JSON.stringify({
          from,
          to: [msg.to],
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
        }),
      });
      if (!res.ok) {
        // Body is Resend's error JSON — safe to log (no token in emails' URLs
        // ever reaches here; only the failure envelope does).
        const body = await res.text().catch(() => "");
        throw new Error(`resend ${res.status}: ${body.slice(0, 300)}`);
      }
      const data = (await res.json()) as { id: string };
      return { id: data.id };
    },
  };
}
