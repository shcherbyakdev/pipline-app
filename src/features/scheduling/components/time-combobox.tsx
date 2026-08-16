"use client"

import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"
import { CheckIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { formatTime, parseTimeInput } from "@/features/scheduling/time-options"

// Base UI's Combobox is explicitly a filterable *Select*: its docs state
// "Combobox does not allow free-form text input" and steer free-text needs
// toward Autocomplete or a manual pattern. Our contract requires committing
// arbitrary parsed values that aren't in `options` (e.g. "9:10" typed while
// the grid is 15-minute increments), which Combobox's items-only selection
// model can't represent without fighting it (its "Creatable" example needs a
// whole extra confirmation dialog). So this composes Popover (Task 5) +
// Input + a hand-rolled ARIA 1.2 combobox/listbox, giving full control over
// commit-on-Enter/blur, revert-on-Escape, and off-grid values — the
// sanctioned fallback the brief calls out.

function optionId(base: string, opt: string): string {
  return `${base}-opt-${opt.replace(":", "")}`
}

export function TimeCombobox({
  value,
  options,
  onCommit,
  label,
  invalid,
  describedBy,
  disabled,
}: {
  value: string
  options: string[]
  onCommit: (hm: string) => void
  label: string
  invalid?: boolean
  describedBy?: string
  disabled?: boolean
}) {
  const reactId = React.useId()
  const listboxId = `${reactId}-listbox`
  const inputRef = React.useRef<HTMLInputElement>(null)

  const [open, setOpen] = React.useState(false)
  const [text, setText] = React.useState(() => formatTime(value))
  // Whether the user has typed since the popup opened. Filtering only kicks
  // in once they have — opening always shows the full option list first.
  const [dirty, setDirty] = React.useState(false)
  // Whether the highlighted row was reached via arrow keys (vs. just being
  // the opening default). Only a keyboard-navigated highlight makes Enter
  // "select an option" instead of "commit typed text".
  const [hasNavigated, setHasNavigated] = React.useState(false)
  const [activeIndex, setActiveIndex] = React.useState(-1)

  const filtered = React.useMemo(() => {
    if (!dirty) return options
    const q = text.trim().toLowerCase()
    if (q === "") return options
    return options.filter(
      (o) => formatTime(o).toLowerCase().includes(q) || o.toLowerCase().includes(q)
    )
  }, [options, text, dirty])

  function openList(navigated: boolean) {
    // Seed the draft from the canonical value every time the popup opens —
    // this is also the only place `text` is set outside of typing, so a
    // closed control always renders `formatTime(value)` (see the input's
    // `value` prop below) without needing an effect to keep them in sync.
    setText(formatTime(value))
    setOpen(true)
    setDirty(false)
    setHasNavigated(navigated)
    setActiveIndex(options.indexOf(value))
  }

  function commit(hm: string) {
    onCommit(hm)
    setOpen(false)
  }

  function commitOrRevertTyped() {
    const parsed = parseTimeInput(text)
    if (parsed && parsed !== value) {
      commit(parsed)
    } else {
      setOpen(false)
    }
  }

  function moveActive(direction: 1 | -1) {
    setHasNavigated(true)
    setActiveIndex((i) => {
      const n = filtered.length
      if (n === 0) return -1
      if (i < 0) return direction === 1 ? 0 : n - 1
      return (i + direction + n) % n
    })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        if (!open) openList(true)
        else moveActive(1)
        break
      case "ArrowUp":
        e.preventDefault()
        if (!open) openList(true)
        else moveActive(-1)
        break
      case "Enter":
        e.preventDefault()
        if (open && hasNavigated && activeIndex >= 0 && activeIndex < filtered.length) {
          commit(filtered[activeIndex])
        } else {
          commitOrRevertTyped()
        }
        break
      case "Escape":
        e.preventDefault()
        setOpen(false)
        break
      default:
        break
    }
  }

  const activeOption =
    open && activeIndex >= 0 && activeIndex < filtered.length ? filtered[activeIndex] : undefined

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <Input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeOption ? optionId(reactId, activeOption) : undefined}
        aria-label={label}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        autoComplete="off"
        disabled={disabled}
        value={open ? text : formatTime(value)}
        onFocus={() => openList(false)}
        onChange={(e) => {
          setText(e.target.value)
          setDirty(true)
          setHasNavigated(false)
          setActiveIndex(-1)
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (open) commitOrRevertTyped()
        }}
        className="w-28 text-center"
      />
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner
          anchor={inputRef}
          side="bottom"
          align="start"
          sideOffset={4}
          className="isolate z-50 outline-none"
        >
          <PopoverPrimitive.Popup
            initialFocus={false}
            finalFocus={false}
            className="z-50 max-h-56 w-(--anchor-width) min-w-28 origin-(--transform-origin) overflow-x-hidden overflow-y-auto overscroll-contain rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 outline-none data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
          >
            <ul id={listboxId} role="listbox" aria-label={label} className="flex flex-col gap-0.5">
              {filtered.length === 0 ? (
                <li className="px-2 py-1.5 text-center text-sm text-muted-foreground">
                  No matches
                </li>
              ) : (
                filtered.map((opt, i) => {
                  const selected = opt === value
                  const highlighted = i === activeIndex
                  return (
                    <li
                      key={opt}
                      id={optionId(reactId, opt)}
                      role="option"
                      aria-selected={selected}
                      data-highlighted={highlighted ? "" : undefined}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setActiveIndex(i)}
                      onClick={() => commit(opt)}
                      className={cn(
                        "relative flex cursor-default items-center justify-center rounded-sm px-2 py-1.5 text-sm select-none",
                        highlighted && "bg-muted text-foreground"
                      )}
                    >
                      {formatTime(opt)}
                      {selected ? (
                        <CheckIcon className="absolute right-1.5 size-3.5 text-muted-foreground" />
                      ) : null}
                    </li>
                  )
                })
              )}
            </ul>
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
