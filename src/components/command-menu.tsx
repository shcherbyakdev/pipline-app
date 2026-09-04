"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Moon, Plus, Sun } from "lucide-react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { UserMultipleIcon } from "@hugeicons/core-free-icons";
import type { NavItem } from "@/components/shell/nav";
import type { OrgMode } from "@/features/orgs/mode";
import { clientsForCommandMenu } from "@/features/clients/actions";
import { useTranslations } from "next-intl";

/** Dispatched on `window` by the top bar's search button; the menu toggles on it
    just like ⌘K. */
export const OPEN_COMMAND_MENU_EVENT = "booklo:open-command-menu";

export function CommandMenu({ items, mode }: { items: NavItem[]; mode: OrgMode }) {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();
  const t = useTranslations("shell");
  const { resolvedTheme, setTheme } = useTheme();

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen((o) => !o);
    document.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_COMMAND_MENU_EVENT, onOpen);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_COMMAND_MENU_EVENT, onOpen);
    };
  }, []);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  // Clients load once, on first open — the palette is the fastest path to a
  // person, but the directory must not cost every page load. Failure just
  // means no Clients group; navigation still works.
  const [clients, setClients] = React.useState<Awaited<ReturnType<typeof clientsForCommandMenu>> | null>(null);
  React.useEffect(() => {
    if (!open || clients !== null) return;
    let cancelled = false;
    clientsForCommandMenu()
      .then((rows) => { if (!cancelled) setClients(rows); })
      .catch(() => { if (!cancelled) setClients([]); });
    return () => { cancelled = true; };
  }, [open, clients]);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder={t("command.placeholder")} />
      <CommandList>
        <CommandEmpty>{t("command.noResults")}</CommandEmpty>
        <CommandGroup heading={t("command.navigate")}>
          {/* Sourced from the same navItemsFor list as the sidebar so the two
              lists can't drift again (this slice is what caused Settings to
              be in one but not the other). Actions below stays hand-listed —
              "create X" only makes sense for Services, not Availability or
              Settings, so there's no drift risk to guard against there. */}
          {items.map((item) => (
            <CommandItem key={item.href} onSelect={() => go(item.href)}>
              <HugeiconsIcon icon={item.icon} size={16} /> {t(`nav.${item.labelKey}`)}
            </CommandItem>
          ))}
        </CommandGroup>
        {clients && clients.length > 0 ? (
          <CommandGroup heading={t("command.clients")}>
            {clients.map((c) => (
              <CommandItem
                key={c.id}
                value={`client ${c.name} ${c.email ?? ""}`}
                onSelect={() => go(`/clients/${c.id}`)}
              >
                <HugeiconsIcon icon={UserMultipleIcon} size={16} /> {c.name}
                {c.email ? <span className="text-muted-foreground ml-auto text-xs">{c.email}</span> : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        <CommandGroup heading={t("command.actions")}>
          {mode.offersAppointments && (
            <CommandItem onSelect={() => go("/services/new")}>
              <Plus className="size-4" /> {t("command.newService")}
            </CommandItem>
          )}
          {mode.offersRentals && (
            <CommandItem onSelect={() => go("/rentals/new")}>
              <Plus className="size-4" /> {t("command.newSpace")}
            </CommandItem>
          )}
        </CommandGroup>
        <CommandGroup heading={t("command.preferences")}>
          <CommandItem
            onSelect={() => {
              setTheme(resolvedTheme === "dark" ? "light" : "dark");
              setOpen(false);
            }}
          >
            {resolvedTheme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            {t("command.toggleTheme")}
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
