import { afterEach, describe, expect, it, vi } from "vitest";
import { resendTransport } from "./resend";

const baseMsg = {
  to: "client@example.com",
  subject: "Hello",
  html: "<p>hi</p>",
  text: "hi",
  idempotencyKey: "booking/1/confirmation",
};

function stubFetch(response: Response) {
  const fake = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(
    async () => response,
  );
  vi.stubGlobal("fetch", fake);
  return fake;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resendTransport", () => {
  it("POSTs the message with the idempotency key and a timeout signal", async () => {
    const fake = stubFetch(Response.json({ id: "re_1" }));
    const transport = resendTransport("re_key", "Booklo <noreply@booklo.co>");
    await expect(transport.send(baseMsg)).resolves.toEqual({ id: "re_1" });

    expect(fake).toHaveBeenCalledTimes(1);
    const [url, init] = fake.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["Idempotency-Key"]).toBe(baseMsg.idempotencyKey);
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer re_key");
    // A hung Resend must not hold a drain tick (and its row claim) open.
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(init?.body as string);
    expect(body).toEqual({
      from: "Booklo <noreply@booklo.co>",
      to: ["client@example.com"],
      subject: "Hello",
      html: "<p>hi</p>",
      text: "hi",
    });
    expect("reply_to" in body).toBe(false);
  });

  it("maps replyTo onto Resend's reply_to", async () => {
    const fake = stubFetch(Response.json({ id: "re_2" }));
    const transport = resendTransport("re_key", "Booklo <noreply@booklo.co>");
    await transport.send({ ...baseMsg, replyTo: "owner@provider.example" });
    const body = JSON.parse(fake.mock.calls[0][1]?.body as string);
    expect(body.reply_to).toBe("owner@provider.example");
  });

  it("throws with the status and a bounded slice of the error body", async () => {
    stubFetch(new Response(JSON.stringify({ message: "x".repeat(1000) }), { status: 422 }));
    const transport = resendTransport("re_key", "Booklo <noreply@booklo.co>");
    await expect(transport.send(baseMsg)).rejects.toThrow(/^resend 422: .{1,300}$/);
  });
});
