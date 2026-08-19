import { describe, expect, it } from "vitest";
import { configHasRemoteRef, isSessionPoolerUrl, migrationsMatch, pushAppliedOverride } from "./setup-production";

describe("configHasRemoteRef", () => {
  const toml = `
[remotes.production]
project_id = "abcdefghijklmnop"
`;

  it("accepts a ref that matches a remotes project_id", () => {
    expect(configHasRemoteRef(toml, "abcdefghijklmnop")).toBe(true);
  });

  // The trap this whole check exists for: a mismatch makes `config push`
  // silently apply the BASE config (localhost site_url, no SMTP,
  // email_sent = 2) and exit 0.
  it("rejects a ref that does not match", () => {
    expect(configHasRemoteRef(toml, "zzzzzzzzzzzzzzzz")).toBe(false);
  });

  it("rejects the committed placeholder", () => {
    expect(configHasRemoteRef(`[remotes.production]\nproject_id = "replacewithprodrefxx"\n`, "abcdefghijklmnop")).toBe(false);
  });
});

describe("pushAppliedOverride", () => {
  it("detects the override banner", () => {
    expect(pushAppliedOverride("Loading config override: [remotes.production]\nFinished")).toBe(true);
  });

  it("rejects output without it", () => {
    expect(pushAppliedOverride("Finished supabase config push.")).toBe(false);
  });
});

describe("isSessionPoolerUrl", () => {
  it("accepts the session pooler, port 5432", () => {
    expect(isSessionPoolerUrl("postgresql://postgres:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres")).toBe(
      true,
    );
  });

  it("rejects the transaction pooler, port 6543", () => {
    expect(
      isSessionPoolerUrl("postgresql://postgres:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres"),
    ).toBe(false);
  });

  it("rejects the direct connection", () => {
    expect(isSessionPoolerUrl("postgresql://postgres:pw@db.abcdefghijklmnop.supabase.co:5432/postgres")).toBe(
      false,
    );
  });

  it("rejects the local dev URL", () => {
    expect(isSessionPoolerUrl("postgresql://postgres:postgres@127.0.0.1:54352/postgres")).toBe(false);
  });
});

describe("migrationsMatch", () => {
  it("passes when applied equals the journal", () => {
    expect(migrationsMatch(47, 47)).toBe(true);
  });

  // Deliberately not "0046 exists": the journal is already at 47 entries and
  // the parked R3 work will renumber.
  it("fails when the remote is behind", () => {
    expect(migrationsMatch(46, 47)).toBe(false);
  });
});
