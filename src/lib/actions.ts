// Result shape every mutation Server Action returns to the client, and the
// only error copy clients ever see (raw errors are logged server-side).
export type ActionState = { ok: true } | { ok: false; error: string };
export const GENERIC_WRITE_ERROR = "Couldn't save. Try again.";
