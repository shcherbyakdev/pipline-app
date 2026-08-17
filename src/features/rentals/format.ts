// Presentation helpers shared by server and client components. They live
// outside components/ on purpose: every export of a "use client" module is a
// client reference, so a Server Component calling one throws
// "Attempted to call hhmm() from the server but hhmm is on the client".

// Postgres `time` comes back as "HH:MM:SS"; <input type="time" step={900}>
// rejects a seconds-bearing value, and TIME_RE only accepts "HH:MM" on the
// way back in — so normalise on both read paths.
export function hhmm(time: string): string {
  return time.slice(0, 5);
}
