import { describe, it, expect } from "vitest";
import { frontDoor, resolveChannelPage, rootRedirect, channelReach } from "./channel-pages";

const BOTH = { services: true, spaces: true };
const APPTS = { services: true, spaces: false };
const SPACES = { services: false, spaces: true };
const NONE = { services: false, spaces: false };

describe("frontDoor (spec 2026-08-28 ruling 5)", () => {
  it("appointments whenever a bookable service exists, else spaces, else nothing", () => {
    expect(frontDoor(BOTH)).toBe("appointments");
    expect(frontDoor(APPTS)).toBe("appointments");
    expect(frontDoor(SPACES)).toBe("spaces");
    expect(frontDoor(NONE)).toBeNull();
  });
});

describe("resolveChannelPage (spec §3.1 truth table)", () => {
  it("root: the front door, canonical at the root; 404 with nothing bookable", () => {
    expect(resolveChannelPage("root", BOTH)).toEqual({ channel: "appointments", canonical: "root" });
    expect(resolveChannelPage("root", APPTS)).toEqual({ channel: "appointments", canonical: "root" });
    expect(resolveChannelPage("root", SPACES)).toEqual({ channel: "spaces", canonical: "root" });
    expect(resolveChannelPage("root", NONE)).toBeNull();
  });
  it("spaces: always the spaces page when spaces are bookable; canonical root only for a spaces-only org", () => {
    expect(resolveChannelPage("spaces", BOTH)).toEqual({ channel: "spaces", canonical: "spaces" });
    expect(resolveChannelPage("spaces", SPACES)).toEqual({ channel: "spaces", canonical: "root" });
    expect(resolveChannelPage("spaces", APPTS)).toBeNull();
    expect(resolveChannelPage("spaces", NONE)).toBeNull();
  });
});

describe("rootRedirect (spec 2026-08-28 §3.2 amendment)", () => {
  const appointmentsRoot = { channel: "appointments", canonical: "root" } as const;
  const spacesRoot = { channel: "spaces", canonical: "root" } as const;

  it("?channel=spaces sends a both-channel org's root to the spaces page", () => {
    expect(rootRedirect("anna", appointmentsRoot, BOTH, { channel: "spaces" })).toBe("/anna/spaces");
  });
  it("a pre-branch ?space=<id> link sends the root to the spaces page, space preselected", () => {
    expect(rootRedirect("anna", appointmentsRoot, BOTH, { space: "o1" })).toBe("/anna/spaces?space=o1");
  });
  it("both params: still one redirect, the space carried along", () => {
    expect(rootRedirect("anna", appointmentsRoot, BOTH, { channel: "spaces", space: "o1" })).toBe("/anna/spaces?space=o1");
  });
  it("an array or empty-string ?space= with no ?channel= is not a link — no redirect", () => {
    expect(rootRedirect("anna", appointmentsRoot, BOTH, { space: ["o1"] })).toBeNull();
    expect(rootRedirect("anna", appointmentsRoot, BOTH, { space: "" })).toBeNull();
  });
  it("a spaces-only org's root IS the spaces page already — no redirect", () => {
    expect(rootRedirect("anna", spacesRoot, SPACES, { channel: "spaces" })).toBeNull();
  });
  it("?channel=services is not a spaces ask — no redirect", () => {
    expect(rootRedirect("anna", appointmentsRoot, BOTH, { channel: "services" })).toBeNull();
  });
  it("an appointments-only org has no spaces page to send it to", () => {
    expect(rootRedirect("anna", appointmentsRoot, APPTS, { channel: "spaces" })).toBeNull();
  });
});

describe("channelReach — what the studio may promise about a channel (Free cap, 2026-09-02)", () => {
  const both = { services: true, spaces: true };
  it("reachable when the plan-limited public catalogue has the channel; capped when the admin has it bookable but the plan hides all of it", () => {
    expect(channelReach("spaces", both, { services: true, spaces: false })).toEqual({ reachable: false, capped: true });
    expect(channelReach("spaces", both, both)).toEqual({ reachable: true, capped: false });
    expect(channelReach("appointments", both, { services: false, spaces: true })).toEqual({ reachable: false, capped: true });
  });
  it("nothing bookable in the admin either: not reachable, not capped — the starter's job, not a plan notice", () => {
    expect(channelReach("spaces", { services: true, spaces: false }, { services: true, spaces: false })).toEqual({ reachable: false, capped: false });
  });
  it("no cap applies (null public view): the admin's own answer stands", () => {
    expect(channelReach("spaces", both, null)).toEqual({ reachable: true, capped: false });
    expect(channelReach("spaces", { services: true, spaces: false }, null)).toEqual({ reachable: false, capped: false });
  });
});
