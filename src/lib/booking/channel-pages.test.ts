import { describe, it, expect } from "vitest";
import { frontDoor, resolveChannelPage } from "./channel-pages";

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
