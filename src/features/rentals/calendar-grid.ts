// Pure month-grid helpers for the public range picker. Months are
// "YYYY-MM", dates "YYYY-MM-DD"; all arithmetic runs through Date.UTC so
// the caller's timezone can never shift a day (the rentals surface is
// org-local by construction — no browser-tz conversion anywhere).

const pad = (n: number) => String(n).padStart(2, "0");

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function firstOfMonth(month: string): string {
  return `${month}-01`;
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  // Date.UTC normalises out-of-range months across year boundaries.
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

// Monday-first weeks; leading/trailing cells outside the month are null
// (no spill-over days — a neighbouring month's date would be selectable
// twice across the two rendered months).
export function monthGrid(month: string): Array<Array<string | null>> {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: Array<string | null> = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${month}-${pad(i + 1)}`),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: Array<Array<string | null>> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
