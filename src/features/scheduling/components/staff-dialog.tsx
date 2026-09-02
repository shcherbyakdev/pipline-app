"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { toastRefusal } from "@/features/billing/refusal-toast";
import { createStaff, updateStaff } from "@/features/scheduling/staff-actions";
import type { StaffRow } from "@/features/scheduling/staff-queries";
import type { ServiceRow } from "@/features/scheduling/queries";
import {
  STAFF_COLORS,
  nextStaffColor,
  slugifyStaffName,
} from "@/features/scheduling/staff-slug";
import { bookingPath } from "@/lib/booking/url";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogBreadcrumbHeader,
  DialogChip,
  DialogContent,
  DialogFooterBar,
  DialogTrigger,
  dialogBareInputClass,
  dialogPanelClass,
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
  gateHref = null,
}: {
  staff?: StaffRow;
  services: ServiceRow[];
  usedColors: string[];
  handle: string | null;
  firstActiveStaffName?: string | null;
  /** Set when the plan would refuse another person (the page asks the same
      gate the action does): the create trigger becomes a link to the door
      instead of a form that can only be refused. */
  gateHref?: string | null;
}) {
  const t = useTranslations("team");
  const tCommon = useTranslations("common");
  const isEdit = Boolean(staff);
  const [open, setOpen] = React.useState(false);
  // Bumped on every open so the form's state initialisers re-run — reopening
  // "New team member" after a save must not show the person just created.
  const [formKey, setFormKey] = React.useState(0);

  const onOpenChange = (next: boolean) => {
    if (next) setFormKey((k) => k + 1);
    setOpen(next);
  };

  // After the hooks (their order must not depend on the gate): a capped org
  // gets the door, not a form the action would refuse.
  if (!isEdit && gateHref) {
    return (
      <Link href={gateHref} className={cn(buttonVariants({ size: "sm" }))}>
        <Plus className="size-4" /> {t("newButton")}
      </Link>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          isEdit ? (
            <Button
              size="sm"
              variant="outline"
              aria-label={t("editNamed", { name: staff!.name })}
            >
              <Pencil className="size-4" /> {tCommon("edit")}
            </Button>
          ) : (
            <Button size="sm">
              <Plus className="size-4" /> {t("newButton")}
            </Button>
          )
        }
      />
      <DialogContent className={cn(dialogPanelClass, "sm:max-w-md")}>
        <DialogBreadcrumbHeader chip={<DialogChip>{t("chip")}</DialogChip>}>
          {isEdit ? t("editNamed", { name: staff!.name }) : t("newButton")}
        </DialogBreadcrumbHeader>
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
  const t = useTranslations("team");
  const tCommon = useTranslations("common");
  const isEdit = Boolean(staff);
  const [pending, startTransition] = React.useTransition();
  const linkPrefix = `${bookingPath(handle ?? "…")}/`;
  // Group headings (colour swatches, service checklist) are <p>s that a
  // role="group" points at — a <label> with no control is an a11y orphan.
  const colourGroupId = React.useId();
  const servicesGroupId = React.useId();
  const [name, setName] = React.useState(staff?.name ?? "");
  const [slug, setSlug] = React.useState(staff?.slug ?? "");
  // An existing person's link is never silently rewritten by a rename — their
  // booking URL may already be out in the world.
  const [slugTouched, setSlugTouched] = React.useState(isEdit);
  const [email, setEmail] = React.useState(staff?.email ?? "");
  const [color, setColor] = React.useState(
    staff?.color ?? nextStaffColor(usedColors),
  );
  // A new person can do everything by default; narrowing is the deliberate act.
  const [serviceIds, setServiceIds] = React.useState<Set<string>>(
    () => new Set(staff ? staff.serviceIds : services.map((s) => s.id)),
  );

  const onNameChange = (value: string) => {
    setName(value);
    if (!slugTouched)
      setSlug(value.trim() === "" ? "" : slugifyStaffName(value));
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
        toastRefusal(result.error, result.upgrade);
        return;
      }
      onDone();
      toast.success(tCommon("saved"));
    });
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col">
      <div className="flex flex-col px-5 pt-4 pb-6">
        <input
          aria-label={tCommon("name")}
          required
          maxLength={80}
          value={name}
          placeholder={t("dialog.namePlaceholder")}
          className={cn(dialogBareInputClass, "text-[15px] font-medium")}
          onChange={(e) => onNameChange(e.target.value)}
          autoFocus
        />
        <input
          aria-label={tCommon("email")}
          type="email"
          maxLength={320}
          placeholder={t("dialog.emailPlaceholder")}
          value={email}
          className={cn(dialogBareInputClass, "mt-3 text-sm")}
          onChange={(e) => setEmail(e.target.value)}
        />

        <div className="mt-6 flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="staff-slug">{t("columns.link")}</Label>
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground shrink-0 font-mono text-xs">{linkPrefix}</span>
              <Input
                id="staff-slug"
                required
                minLength={2}
                maxLength={40}
                pattern={SLUG_PATTERN}
                title={t("dialog.slugHint")}
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  // Typing can't produce a character the slug rules reject.
                  setSlug(
                    e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
                  );
                }}
              />
            </div>
          </div>

          <div
            role="group"
            aria-labelledby={colourGroupId}
            className="flex flex-col gap-2"
          >
            <p id={colourGroupId} className="text-sm leading-none font-medium">
              {t("dialog.colour")}
            </p>
            <div className="flex flex-wrap gap-2">
              {STAFF_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={t("dialog.colourNamed", { hex: c })}
                  aria-pressed={color === c}
                  onClick={() => setColor(c)}
                  style={{ background: c }}
                  className={cn(
                    "size-6 rounded-full ring-offset-2 ring-offset-popover outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    color === c
                      ? "ring-2 ring-foreground"
                      : "ring-1 ring-black/10",
                  )}
                />
              ))}
            </div>
          </div>

          {services.length > 0 ? (
            <div
              role="group"
              aria-labelledby={servicesGroupId}
              className="flex flex-col gap-2"
            >
              <p
                id={servicesGroupId}
                className="text-sm leading-none font-medium"
              >
                {t("dialog.services")}
              </p>
              <ul className="flex flex-col gap-1.5">
                {services.map((service) => (
                  <li key={service.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`staff-service-${service.id}`}
                      checked={serviceIds.has(service.id)}
                      onCheckedChange={(checked) =>
                        toggleService(service.id, checked === true)
                      }
                    />
                    <Label
                      htmlFor={`staff-service-${service.id}`}
                      className="flex items-center gap-2 text-sm font-normal"
                    >
                      {service.name}
                      {!service.active ? (
                        <Badge variant="outline">{tCommon("inactive")}</Badge>
                      ) : null}
                    </Label>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {!isEdit && firstActiveStaffName ? (
            <p className="text-muted-foreground text-xs">
              {t("dialog.inheritsHours", { name: firstActiveStaffName })}
            </p>
          ) : null}
        </div>
      </div>

      <DialogFooterBar>
        <Button type="submit" size="sm" variant="brand" disabled={pending}>
          {pending ? tCommon("saving") : tCommon("save")}
        </Button>
      </DialogFooterBar>
    </form>
  );
}
