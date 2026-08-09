/**
 * Pure parsing/merging for `.env` files and `supabase status -o env` output.
 * No filesystem access, no process access — everything here is string in,
 * string out, so the overwrite guarantee in `fillBlankEnvValues` is testable.
 */

// KEY=value, tolerating surrounding whitespace and an optional leading
// `export ` (dotenv — which Next.js uses — and shells both honour it, so a
// parser that ignores it would miss real assignments). Value runs to end of
// line so connection strings keep their own `=` characters.
const ASSIGNMENT = /^\s*(export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

function unquote(raw: string): string {
  const value = raw.trim();
  const quoted =
    (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
  return quoted && value.length >= 2 ? value.slice(1, -1) : value;
}

export function parseEnvFile(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of contents.split("\n")) {
    if (line.trim().startsWith("#")) continue;
    const match = ASSIGNMENT.exec(line);
    if (match) out[match[2]] = unquote(match[3]);
  }
  return out;
}

/**
 * `supabase status -o env` interleaves assignments with human-readable noise
 * ("Stopped services: [...]", CLI upgrade notices). Only well-formed
 * SCREAMING_SNAKE assignments are accepted; everything else is dropped.
 */
export function parseSupabaseStatusEnv(stdout: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of stdout.split("\n")) {
    const match = /^([A-Z][A-Z0-9_]*)="(.*)"\s*$/.exec(line.trim());
    if (match) out[match[1]] = match[2];
  }
  return out;
}

const SUPABASE_TO_APP: Record<string, string> = {
  API_URL: "NEXT_PUBLIC_SUPABASE_URL",
  ANON_KEY: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  SERVICE_ROLE_KEY: "SUPABASE_SERVICE_ROLE_KEY",
  DB_URL: "DATABASE_URL",
};

export function supabaseEnvToAppEnv(status: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [from, to] of Object.entries(SUPABASE_TO_APP)) {
    if (status[from]) out[to] = status[from];
  }
  return out;
}

/**
 * Fill blank keys from `values`, leaving every non-empty value untouched.
 * A developer pointed at a remote Supabase project must never be silently
 * redirected to localhost — that is the one hard rule of this function.
 */
export function fillBlankEnvValues(
  contents: string,
  values: Record<string, string>,
): { contents: string; filled: string[] } {
  const filled: string[] = [];
  const seen = new Set<string>();

  const lines = contents.split("\n").map((line) => {
    if (line.trim().startsWith("#")) return line;
    const match = ASSIGNMENT.exec(line);
    if (!match) return line;

    const [, exportPrefix, key, rawValue] = match;
    seen.add(key);
    if (unquote(rawValue) !== "" || !values[key]) return line;

    filled.push(key);
    // Preserve the `export ` prefix verbatim (including its exact
    // whitespace) so filling a blank value doesn't rewrite the developer's
    // file style.
    return `${exportPrefix ?? ""}${key}=${values[key]}`;
  });

  // Drop a single trailing empty line so appends and the final newline below
  // don't compound into a growing run of blank lines on repeat runs.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  for (const [key, value] of Object.entries(values)) {
    if (seen.has(key)) continue;
    filled.push(key);
    lines.push(`${key}=${value}`);
  }

  return { contents: `${lines.join("\n")}\n`, filled };
}
