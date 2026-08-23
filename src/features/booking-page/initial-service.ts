// `?service=` deep link (pairs with the embed's `?staff=`): a uuid naming one
// of the plan-limited services, else null. Pure — the page passes the result
// into PageStateProvider; unknown ids are simply ignored.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function resolveInitialService(
  services: ReadonlyArray<{ id: string }>,
  param: string | string[] | undefined,
): string | null {
  if (typeof param !== "string" || !UUID_RE.test(param)) return null;
  return services.some((s) => s.id === param) ? param : null;
}
