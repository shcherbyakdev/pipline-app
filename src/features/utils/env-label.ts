/** "<NODE_ENV> · <app host>" for the /utils masthead — so the owner can never
    mistake which database is being edited (spec §3.2). Pure; the layout
    feeds it process.env.NODE_ENV and env.NEXT_PUBLIC_APP_URL. */
export function envLabel(nodeEnv: string | undefined, appUrl: string): string {
  let host = appUrl;
  try {
    host = new URL(appUrl).host;
  } catch {
    /* keep the raw string — still tells the owner something */
  }
  return `${nodeEnv || "unknown"} · ${host}`;
}
