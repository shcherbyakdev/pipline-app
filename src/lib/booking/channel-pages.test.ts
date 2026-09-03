import { describe, it, expect } from "vitest";
import { frontDoor, channelReach } from "./channel-pages";

const APPTS = { services: true, spaces: false };
const SPACES = { services: false, spaces: true };
const NONE = { services: false, spaces: false };

describe("frontDoor (spec 2026-08-28 ruling 5, one channel per org)", () => {
  it("the org's channel when something in it is bookable, else nothing (404)", () => {
    expect(frontDoor(APPTS)).toBe("appointments");
    expect(frontDoor(SPACES)).toBe("spaces");
    expect(frontDoor(NONE)).toBeNull();
  });
});

describe("channelReach — what the studio may promise about a channel (Free cap, 2026-09-02)", () => {
  it("reachable when the plan-limited public catalogue has the channel; capped when the admin has it bookable but the plan hides all of it", () => {
    expect(channelReach("spaces", SPACES, NONE)).toEqual({ reachable: false, capped: true });
    expect(channelReach("spaces", SPACES, SPACES)).toEqual({ reachable: true, capped: false });
    expect(channelReach("appointments", APPTS, NONE)).toEqual({ reachable: false, capped: true });
  });
  it("nothing bookable in the admin either: not reachable, not capped — the starter's job, not a plan notice", () => {
    expect(channelReach("spaces", APPTS, APPTS)).toEqual({ reachable: false, capped: false });
  });
  it("no cap applies (null public view): the admin's own answer stands", () => {
    expect(channelReach("spaces", SPACES, null)).toEqual({ reachable: true, capped: false });
    expect(channelReach("spaces", APPTS, null)).toEqual({ reachable: false, capped: false });
  });
});
