import { describe, it, expect } from "vitest";
import { filterBookableServices } from "./bookable";

const anna = { id: "a" };
const ben = { id: "b" };
const cut = { id: "cut" };
const colour = { id: "colour" };

describe("filterBookableServices", () => {
  // The regression this guards: /book and /embed listed every active service,
  // so a service linked to nobody (or only to people since deactivated) put a
  // card on the page whose confirm step can only ever fail.
  it("drops a service with no staff links at all", () => {
    expect(filterBookableServices([cut, colour], { cut: ["a"] }, [anna])).toEqual([cut]);
  });

  it("drops a service whose only linked staff are inactive", () => {
    // `serviceStaffIds` is unfiltered by staff.active — the active roster is
    // what decides, so a link to someone absent from it counts for nothing.
    expect(filterBookableServices([cut], { cut: ["b"] }, [anna])).toEqual([]);
  });

  it("keeps a service as long as one linked member is active", () => {
    expect(filterBookableServices([cut], { cut: ["b", "a"] }, [anna])).toEqual([cut]);
  });

  it("empty roster leaves nothing bookable", () => {
    expect(filterBookableServices([cut, colour], { cut: ["a"], colour: ["b"] }, [])).toEqual([]);
  });

  it("onlyStaffId narrows to what that person offers", () => {
    const map = { cut: ["a", "b"], colour: ["b"] };
    expect(filterBookableServices([cut, colour], map, [anna, ben], "a")).toEqual([cut]);
    expect(filterBookableServices([cut, colour], map, [anna, ben], "b")).toEqual([cut, colour]);
  });

  it("onlyStaffId who is not on the active roster offers nothing", () => {
    expect(filterBookableServices([cut], { cut: ["b"] }, [anna], "b")).toEqual([]);
  });

  it("preserves input order and identity", () => {
    const services = [colour, cut];
    const out = filterBookableServices(services, { cut: ["a"], colour: ["a"] }, [anna]);
    expect(out).toEqual([colour, cut]);
    expect(out[0]).toBe(colour);
  });
});
