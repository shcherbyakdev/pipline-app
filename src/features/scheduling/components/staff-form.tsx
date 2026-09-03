"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { toastRefusal } from "@/features/billing/refusal-toast";
import { createStaff } from "@/features/scheduling/staff-actions";
import type { ServiceRow } from "@/features/scheduling/queries";
import { STAFF_SLUG_PATTERN, nextStaffColor, slugifyStaffName } from "@/features/scheduling/staff-slug";
import { ColorSwatches } from "./color-swatches";
import { bookingPath } from "@/lib/booking/url";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/* A new person's details — the whole of /team/new (there is no dialog; the
   page IS the form). An existing person is edited in place on their own page
   (member-header.tsx, member-services.tsx). A save goes back to the roster. */
export function StaffForm({
  services,
  usedColors,
  handle,
  firstActiveStaffName,
}: {
  services: ServiceRow[];
  usedColors: string[];
  handle: string | null;
  firstActiveStaffName: string | null;
}) {
  const t = useTranslations("team");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const linkPrefix = `${bookingPath(handle ?? "…")}/`;
  // The checklist heading is a <p> that a role="group" points at — a <label>
  // with no control is an a11y orphan.
  const servicesGroupId = React.useId();
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  // The link follows the name until the owner touches it.
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [color, setColor] = React.useState(() => nextStaffColor(usedColors));
  // A new person can do everything by default; narrowing is the deliberate act.
  const [serviceIds, setServiceIds] = React.useState<Set<string>>(
    () => new Set(services.map((s) => s.id)),
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
      const result = await createStaff(payload);
      if (!result.ok) {
        toastRefusal(result.error, result.upgrade);
        return;
      }
      toast.success(tCommon("saved"));
      router.push("/team");
    });
  };

  return (
    <form onSubmit={onSubmit} className="flex max-w-lg flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="staff-name">{tCommon("name")}</Label>
          <Input
            id="staff-name"
            required
            maxLength={80}
            value={name}
            placeholder={t("form.namePlaceholder")}
            onChange={(e) => onNameChange(e.target.value)}
            autoFocus
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="staff-email">{tCommon("email")}</Label>
          <Input
            id="staff-email"
            type="email"
            maxLength={320}
            placeholder={t("form.emailPlaceholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="staff-slug">{t("columns.link")}</Label>
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground shrink-0 font-mono text-xs">{linkPrefix}</span>
          <Input
            id="staff-slug"
            required
            minLength={2}
            maxLength={40}
            pattern={STAFF_SLUG_PATTERN}
            title={t("form.slugHint")}
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

      <div className="flex flex-col gap-2">
        <p className="text-sm leading-none font-medium">{t("form.colour")}</p>
        <ColorSwatches value={color} onChange={setColor} />
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
            {t("form.services")}
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

      {firstActiveStaffName ? (
        <p className="text-muted-foreground text-xs">
          {t("form.inheritsHours", { name: firstActiveStaffName })}
        </p>
      ) : null}

      <div>
        <Button type="submit" size="sm" variant="brand" disabled={pending}>
          {pending ? tCommon("saving") : t("newButton")}
        </Button>
      </div>
    </form>
  );
}
