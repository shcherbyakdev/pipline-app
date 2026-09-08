import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// digest.ts -> notify.ts/push.ts reach @/env at module scope; every
// dependency is injected here, so the modules only need to load (notify.test.ts idiom).
vi.mock("@/env", () => ({ env: {} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => { throw new Error("not used"); } }));
vi.mock("@/lib/email/transport", () => ({ selectTransport: () => { throw new Error("not used"); } }));

import { DIGEST_BATCH, DIGEST_LOCAL_HOUR } from "./digest";

/* The hour and the batch live in SQL (0083 digest_due_orgs) and are
   mirrored here; prefs.test.ts's parity idiom — the migration is the
   enforcement, the TS constant the documentation. */
describe("digest constants parity with 0083", () => {
  const sql = readFileSync(join(process.cwd(), "src/db/migrations/0083_daily_list.sql"), "utf8");
  const body = sql.slice(sql.indexOf("create function public.digest_due_orgs"));

  it("DIGEST_LOCAL_HOUR equals the hour literal in digest_due_orgs()", () => {
    const hit = /extract\(hour from now\(\) at time zone o\.timezone\) >= (\d+)/.exec(body);
    expect(hit, "hour literal not found").not.toBeNull();
    expect(Number(hit![1])).toBe(DIGEST_LOCAL_HOUR);
  });

  it("DIGEST_BATCH equals the LIMIT in digest_due_orgs()", () => {
    const hit = /limit (\d+);/.exec(body);
    expect(hit, "limit not found").not.toBeNull();
    expect(Number(hit![1])).toBe(DIGEST_BATCH);
  });
});
