// `?service=` / `?space=` deep links (the embed also takes `?staff=`): a uuid
// naming one item of the gated, channel-filtered catalogue, else null. Pure —
// the page passes the result into PageStateProvider (hosted page) or straight
// to the widget's request props (embed); unknown ids are simply ignored, so a
// stale link degrades to the org flow instead of 404ing.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function resolveListedId(items: ReadonlyArray<{ id: string }>, param: string | string[] | undefined): string | null {
  if (typeof param !== "string" || !UUID_RE.test(param)) return null;
  return items.some((s) => s.id === param) ? param : null;
}

export function resolveInitialService(
  services: ReadonlyArray<{ id: string }>,
  param: string | string[] | undefined,
): string | null {
  return resolveListedId(services, param);
}

export function resolveInitialOffering(
  offerings: ReadonlyArray<{ id: string }>,
  param: string | string[] | undefined,
): string | null {
  return resolveListedId(offerings, param);
}
