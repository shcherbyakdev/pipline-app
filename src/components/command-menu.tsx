"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { LayoutGrid, FileStack, Building2, Moon, Plus, Sun } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export function CommandMenu() {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Navigate">
          <CommandItem onSelect={() => go("/programs")}>
            <LayoutGrid className="size-4" /> Programs
          </CommandItem>
          <CommandItem onSelect={() => go("/templates")}>
            <FileStack className="size-4" /> Templates
          </CommandItem>
          <CommandItem onSelect={() => go("/clients")}>
            <Building2 className="size-4" /> Clients
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => go("/programs?new=1")}>
            <Plus className="size-4" /> Create program
          </CommandItem>
          <CommandItem onSelect={() => go("/templates?new=1")}>
            <Plus className="size-4" /> Create template
          </CommandItem>
          <CommandItem onSelect={() => go("/clients?new=1")}>
            <Plus className="size-4" /> Create client
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="Preferences">
          <CommandItem
            onSelect={() => {
              setTheme(resolvedTheme === "dark" ? "light" : "dark");
              setOpen(false);
            }}
          >
            {resolvedTheme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            Toggle theme
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
