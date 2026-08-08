import { LayoutGrid, FileStack } from "lucide-react";

export const NAV_ITEMS = [
  { href: "/rollouts", label: "Rollouts", icon: LayoutGrid },
  { href: "/templates", label: "Templates", icon: FileStack },
] as const;
