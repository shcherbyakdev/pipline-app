import { FLAG_DEFAULTS, FLAG_KEYS, FLAG_META } from "@/lib/flags";
import { Button } from "@/components/ui/button";
import { setOrgFlag } from "../actions";
import type { OrgAdminView } from "../queries";

const formatInstant = (iso: string) =>
  `${new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC",
  }).format(new Date(iso))} UTC`;

/* One row per flag: what it does, the environment default, the org's current
   state, and three submit buttons that post the same action with a different
   `value`. The active choice is the primary button. */
export function FlagsTable({ view }: { view: OrgAdminView }) {
  const byFlag = new Map(view.flags.map((r) => [r.flag, r]));
  return (
    <ul className="divide-y rounded-lg border">
      {FLAG_KEYS.map((key) => {
        const row = byFlag.get(key);
        const state: "default" | "on" | "off" = row ? (row.enabled ? "on" : "off") : "default";
        const effective = row ? row.enabled : FLAG_DEFAULTS[key];
        return (
          <li key={key} className="flex flex-col gap-2 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">{FLAG_META[key].label}</span>
              <span className="font-mono text-xs">
                effective: {effective ? "on" : "off"} · default: {FLAG_DEFAULTS[key] ? "on" : "off"}
              </span>
            </div>
            <p className="text-muted-foreground text-sm">{FLAG_META[key].description}</p>
            <form action={setOrgFlag} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="org" value={view.org.id} />
              <input type="hidden" name="flag" value={key} />
              {(["default", "on", "off"] as const).map((value) => (
                <Button
                  key={value}
                  type="submit"
                  name="value"
                  value={value}
                  size="sm"
                  variant={state === value ? "default" : "secondary"}
                  aria-pressed={state === value}
                >
                  {value === "default" ? "Default" : value === "on" ? "On" : "Off"}
                </Button>
              ))}
              {row ? (
                <span className="text-muted-foreground text-xs">
                  set by {row.updatedBy} · {formatInstant(row.updatedAt)}
                </span>
              ) : null}
            </form>
          </li>
        );
      })}
    </ul>
  );
}
