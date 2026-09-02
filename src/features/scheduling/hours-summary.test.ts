import { describe, it, expect } from "vitest";
import { enTranslator } from "@/i18n/test-translator";
import { summarizeWeekly as summarize } from "./hours-summary";

const t = enTranslator("availability");
const summarizeWeekly = (rules: Parameters<typeof summarize>[0]) => summarize(rules, t);

const w = (weekday: number, startTime: string, endTime: string) => ({ weekday, startTime, endTime });
const NINE_TO_FIVE = (d: number) => w(d, "09:00", "17:00");

describe("summarizeWeekly (spec §3 — the space detail card)", () => {
  it("no rules → the closed line", () => {
    expect(summarizeWeekly([])).toBe("Closed — no hours set");
  });
  it("groups consecutive weekdays with identical windows; runs are joined with a middle dot", () => {
    const rules = [1, 2, 3, 4, 5].map(NINE_TO_FIVE).concat(w(6, "10:00", "14:00"));
    expect(summarizeWeekly(rules)).toBe("Mon–Fri 9:00–17:00 · Sat 10:00–14:00");
  });
  it("a day without hours or with different hours breaks the run", () => {
    expect(summarizeWeekly([1, 2, 3, 5].map(NINE_TO_FIVE))).toBe("Mon–Wed 9:00–17:00 · Fri 9:00–17:00");
    expect(summarizeWeekly([NINE_TO_FIVE(1), NINE_TO_FIVE(2), w(3, "09:00", "13:00")])).toBe(
      "Mon–Tue 9:00–17:00 · Wed 9:00–13:00",
    );
  });
  it("several windows in one day are joined with a comma, sorted by start", () => {
    expect(summarizeWeekly([w(1, "14:00", "18:00"), w(1, "09:00", "12:00")])).toBe("Mon 9:00–12:00, 14:00–18:00");
  });
  it("the week runs Monday to Sunday", () => {
    expect(summarizeWeekly([w(6, "10:00", "14:00"), w(0, "10:00", "14:00")])).toBe("Sat–Sun 10:00–14:00");
    expect(summarizeWeekly([w(0, "10:00", "14:00"), w(1, "10:00", "14:00")])).toBe("Mon 10:00–14:00 · Sun 10:00–14:00");
  });
  it("accepts PostgREST's HH:MM:SS and unsorted input", () => {
    expect(summarizeWeekly([w(2, "09:00:00", "17:30:00"), w(1, "09:00:00", "17:30:00")])).toBe("Mon–Tue 9:00–17:30");
  });
});
