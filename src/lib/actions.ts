import type { UpgradeDoor } from "@/lib/billing/refusal";

// Result shape every mutation Server Action returns to the client, and the
// only error copy clients ever see (raw errors are logged server-side).
// `notice`: the write succeeded but a secondary step did not (a space saved
// without its first unit) — shown as a warning, never as a failure.
// `upgrade`: a plan cap's way out (lib/billing/refusal.ts), rendered by
// toastRefusal as the toast's action — beside an error, or beside a notice
// when the write itself landed (a space saved without its first unit).
// `id`: what a create made, for a client that lands on the new row's page.
export type ActionState =
  | { ok: true; notice?: string; upgrade?: UpgradeDoor | null; id?: string }
  | { ok: false; error: string; upgrade?: UpgradeDoor | null };
export const GENERIC_WRITE_ERROR = "Couldn't save. Try again.";
