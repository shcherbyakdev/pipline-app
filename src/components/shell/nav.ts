import { LayoutGrid, FileStack, Building2, Settings2 } from "lucide-react";

export const NAV_ITEMS = [
  { href: "/programs", label: "Programs", icon: LayoutGrid },
  { href: "/templates", label: "Templates", icon: FileStack },
  { href: "/clients", label: "Clients", icon: Building2 },
  { href: "/settings", label: "Settings", icon: Settings2 },
] as const;
