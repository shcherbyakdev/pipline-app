import { addMonths, firstOfMonth, monthOf } from "./calendar-grid";
import { daysBetween } from "./range";

/* What the stays picker fetches (widget templates spec §8 review fix): the
   month(s) it shows plus the turnover tail — and, once a check-in is
   picked in an earlier month, that month too, so the check-out month can
   still validate the whole stay (validateStay reads every occupied day).
   Capped at getRangeAvailability's 93 days. */
export function stayFetchWindow({ shown, months, start, turnoverDays }: { shown: string; months: 1 | 2; start: string | null; turnoverDays: number }): { from: string; days: number } {
  const startMonth = start ? monthOf(start) : null;
  const from = firstOfMonth(startMonth && startMonth < shown ? startMonth : shown);
  const lastMonth = months === 2 ? addMonths(shown, 1) : shown;
  const end = firstOfMonth(addMonths(lastMonth, 1)); // exclusive
  return { from, days: Math.min(93, daysBetween(from, end) + turnoverDays) };
}
