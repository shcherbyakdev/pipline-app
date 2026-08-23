"use client";

import * as React from "react";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { createStaff, updateStaff } from "@/features/scheduling/staff-actions";
import type { StaffRow } from "@/features/scheduling/staff-queries";
import type { ServiceRow } from "@/features/scheduling/queries";
import { STAFF_COLORS, nextStaffColor, slugifyStaffName } from "@/features/scheduling/staff-slug";
import { bookingPath } from "@/lib/booking/url";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// Browser-side twin of STAFF_SLUG_RE (zod and the DB CHECK are still the
// authorities). Hand-written rather than derived from the regex's source:
// `pattern` is compiled with the `v` flag, which rejects an unescaped literal
// `-` inside a character class — and an invalid pattern is silently ignored,
// i.e. no validation at all. The 2-character floor is the input's minLength.
const SLUG_PATTERN = "[a-z0-9]([a-z0-9\\-]{0,38}[a-z0-9])?";

export function StaffDialog({
  staff,
  services,
  usedColors,
  handle,
  firstActiveStaffName,
}: {
  staff?: StaffRow;
  services: ServiceRow[];
  usedColors: string[];
  handle: string | null;
  firstActiveStaffName?: string | null;
}) {
  const isEdit = Boolean(staff);
  const [open, setOpen] = React.useState(false);
  // Bumped on every open so the form's state initialisers re-run — reopening
  // "New team member" after a save must not show the person just created.
  const [formKey, setFormKey] = React.useState(0);

  const onOpenChange = (next: boolean) => {
    if (next) setFormKey((k) => k + 1);
    setOpen(next);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          isEdit ? (
            <Button size="sm" variant="outline" aria-label={`Edit ${staff!.name}`}>
              <Pencil className="size-4" /> Edit
            </Button>
          ) : (
            <Button size="sm">
              <Plus className="size-4" /> New team member
            </Button>
          )
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${staff!.name}` : "New team member"}</DialogTitle>
        </DialogHeader>
        <StaffForm
          key={formKey}
          staff={staff}
          services={services}
          usedColors={usedColors}
          handle={handle}
          firstActiveStaffName={firstActiveStaffName}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function StaffForm({
  staff,
  services,
  usedColors,
  handle,
  firstActiveStaffName,
  onDone,
}: {
  staff?: StaffRow;
  services: ServiceRow[];
  usedColors: string[];
  handle: string | null;
  firstActiveStaffName?: string | null;
  onDone: () => void;
}) {
  const isEdit = Boolean(staff);
  const [pending, startTransition] = React.useTransition();
  const [name, setName] = React.useState(staff?.name ?? "");
  const [slug, setSlug] = React.useState(staff?.slug ?? "");
  // An existing person's link is never silently rewritten by a rename — their
  // booking URL may already be out in the world.
  const [slugTouched, setSlugTouched] = React.useState(isEdit);
  const [email, setEmail] = React.useState(staff?.email ?? "");
  const [color, setColor] = React.useState(staff?.color ?? nextStaffColor(usedColors));
  // A new person can do everything by default; narrowing is the deliberate act.
  const [serviceIds, setServiceIds] = React.useState<Set<string>>(
    () => new Set(staff ? staff.serviceIds : services.map((s) => s.id)),
  );

  const onNameChange = (value: string) => {
    setName(value);
    if (!slugTouched) setSlug(value.trim() === "" ? "" : slugifyStaffName(value));
  };

  const toggleService = (id: string, checked: boolean) =>
    setServiceIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "") return;
    const payload = {
      name: trimmed,
      slug,
      email,
      color,
      serviceIds: [...serviceIds],
    };
    startTransition(async () => {
      const result = staff
        ? await updateStaff({ id: staff.id, ...payload })
        : await createStaff(payload);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onDone();
      toast.success("Saved");
    });
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="staff-name">Name</Label>
        <Input
          id="staff-name"
          required
          maxLength={80}
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          autoFocus
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="staff-slug">Booking link</Label>
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground shrink-0 font-mono text-xs">
            {bookingPath(handle ?? "…")}/
          </span>
          <Input
            id="staff-slug"
            required
            minLength={2}
            maxLength={40}
            pattern={SLUG_PATTERN}
            title="Lowercase letters, numbers and dashes."
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              // Typing can't produce a character the slug rules reject.
              setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
            }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="staff-email">Email</Label>
        <Input
          id="staff-email"
          type="email"
          maxLength={320}
          placeholder="Optional — for booking notices"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Colour</Label>
        <div className="flex flex-wrap gap-2">
          {STAFF_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Colour ${c}`}
              aria-pressed={color === c}
              onClick={() => setColor(c)}
              style={{ background: c }}
              className={cn(
                "size-6 rounded-full ring-offset-2 ring-offset-popover outline-none focus-visible:ring-2 focus-visible:ring-ring",
                color === c ? "ring-2 ring-foreground" : "ring-1 ring-black/10",
              )}
            />
          ))}
        </div>
      </div>

      {services.length > 0 ? (
        <div className="flex flex-col gap-2">
          <Label>Services</Label>
          <ul className="flex flex-col gap-1.5">
            {services.map((service) => (
              <li key={service.id} className="flex items-center gap-2">
                <Checkbox
                  id={`staff-service-${service.id}`}
                  checked={serviceIds.has(service.id)}
                  onCheckedChange={(checked) => toggleService(service.id, checked === true)}
                />
                <Label
                  htmlFor={`staff-service-${service.id}`}
                  className="flex items-center gap-2 text-sm font-normal"
                >
                  {service.name}
                  {!service.active ? <Badge variant="outline">Inactive</Badge> : null}
                </Label>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!isEdit && firstActiveStaffName ? (
        <p className="text-muted-foreground text-xs">
          Starts with {firstActiveStaffName}&apos;s weekly hours — edit them on Availability.
        </p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
