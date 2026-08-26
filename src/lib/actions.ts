// Result shape every mutation Server Action returns to the client, and the
// only error copy clients ever see (raw errors are logged server-side).
// `notice`: the write succeeded but a secondary step did not (a space saved
// without its first unit) — shown as a warning, never as a failure.
export type ActionState = { ok: true; notice?: string } | { ok: false; error: string };
export const GENERIC_WRITE_ERROR = "Couldn't save. Try again.";
