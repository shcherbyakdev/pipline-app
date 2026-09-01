"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "@/lib/utils";

/* The app's one switch look (Linear-style; extracted from the Team table so
   every on/off toggle reads the same). */
export function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "border-input bg-muted focus-visible:ring-ring/50 data-checked:border-brand data-checked:bg-brand relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors outline-none focus-visible:ring-3 data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="bg-background size-3.5 translate-x-0.5 rounded-full shadow-sm transition-[translate] data-checked:translate-x-[18px]" />
    </SwitchPrimitive.Root>
  );
}
