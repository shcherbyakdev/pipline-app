import { describe, it, expect } from "vitest";
import { isNoticeDismissed, noticeToken, withNoticeDismissed } from "./plan-notice";

const token = (kind: string, sig: string | number) => noticeToken("org-1", kind, sig);

describe("plan notice dismissal", () => {
  it("uses characters a cookie codec leaves alone (Next writes encoded, reads raw)", () => {
    const jar = withNoticeDismissed(withNoticeDismissed(undefined, token("resources", 5)), token("reminders", "2026-09-near"));
    expect(encodeURIComponent(jar)).toBe(jar);
  });
  it("remembers one token without forgetting the other notice", () => {
    let jar = withNoticeDismissed(undefined, token("resources", 1));
    jar = withNoticeDismissed(jar, token("reminders", "2026-09-near"));
    expect(isNoticeDismissed(jar, token("resources", 1))).toBe(true);
    expect(isNoticeDismissed(jar, token("reminders", "2026-09-near"))).toBe(true);
  });
  it("comes back when what the notice says changes — or the org does", () => {
    const jar = withNoticeDismissed(undefined, token("resources", 1));
    expect(isNoticeDismissed(jar, token("resources", 2))).toBe(false);
    expect(isNoticeDismissed(jar, token("reminders", "2026-10-near"))).toBe(false);
    expect(isNoticeDismissed(jar, noticeToken("org-2", "resources", 1))).toBe(false);
  });
  it("keeps the cookie bounded, newest first out the door last", () => {
    let jar: string | undefined;
    for (let i = 0; i < 9; i++) jar = withNoticeDismissed(jar, token("resources", i));
    expect(jar!.split("~")).toHaveLength(6);
    expect(isNoticeDismissed(jar, token("resources", 8))).toBe(true);
    expect(isNoticeDismissed(jar, token("resources", 0))).toBe(false);
  });
  it("re-dismissing does not duplicate", () => {
    const once = withNoticeDismissed(undefined, token("resources", 1));
    expect(withNoticeDismissed(once, token("resources", 1))).toBe(once);
  });
});
