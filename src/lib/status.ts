export type UnitStatus =
  | "not_started"
  | "in_progress"
  | "complete"
  | "at_risk"
  | "blocked";

// className uses static token utilities so Tailwind can see them at build time.
const META: Record<UnitStatus, { label: string; className: string }> = {
  not_started: { label: "Not started", className: "bg-status-not-started/10 text-status-not-started border-status-not-started/20" },
  in_progress: { label: "In progress", className: "bg-status-in-progress/10 text-status-in-progress border-status-in-progress/20" },
  complete: { label: "Complete", className: "bg-status-complete/10 text-status-complete border-status-complete/20" },
  at_risk: { label: "At risk", className: "bg-status-at-risk/10 text-status-at-risk border-status-at-risk/20" },
  blocked: { label: "Blocked", className: "bg-status-blocked/10 text-status-blocked border-status-blocked/20" },
};

export const STATUS_ORDER: UnitStatus[] = [
  "not_started",
  "in_progress",
  "complete",
  "at_risk",
  "blocked",
];

export function getStatusMeta(status: UnitStatus) {
  return META[status];
}
