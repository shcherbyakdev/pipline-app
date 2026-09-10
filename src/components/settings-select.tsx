"use client";

import { CheckIcon, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type SettingsOption<T extends string> = {
  value: T;
  label: string;
  /** One line under the label in the menu, where the choice has a consequence. */
  hint?: string;
  /** For a language: the option names itself, so a screen reader says it right. */
  lang?: string;
};

/* The one control on the right of a settings row (Linear preferences): the
   current choice named on a quiet button, the rest behind it. Every caller
   autosaves on pick, so there is no separate Save. */
export function SettingsSelect<T extends string>({
  label,
  value,
  options,
  onSelect,
  disabled,
  busy,
}: {
  /** Names the trigger for screen readers — the row heading is not tied to it. */
  label: string;
  value: T;
  options: readonly SettingsOption<T>[];
  onSelect: (value: T) => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  const current = options.find((o) => o.value === value);
  const detailed = options.some((o) => o.hint);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        render={
          <Button variant="outline" size="sm" aria-label={label} aria-busy={busy}>
            <span lang={current?.lang}>{current?.label ?? ""}</span>
            <ChevronDown className="text-muted-foreground" data-icon="inline-end" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className={detailed ? "w-72" : "w-44"}>
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            lang={option.lang}
            className={detailed ? "items-start gap-2 py-1.5" : undefined}
            onClick={() => {
              if (option.value !== value) onSelect(option.value);
            }}
          >
            <CheckIcon
              className={cn("size-3.5", detailed && "mt-0.5", option.value !== value && "invisible")}
              aria-hidden
            />
            <span className="flex flex-col gap-0.5">
              {option.label}
              {option.hint ? <span className="text-muted-foreground text-xs leading-4">{option.hint}</span> : null}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
