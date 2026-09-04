"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { toastRefusal } from "@/features/billing/refusal-toast";
import { createService, updateService } from "@/features/scheduling/actions";
import type { ServiceRow } from "@/features/scheduling/queries";
import type { StaffRow } from "@/features/scheduling/staff-queries";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { dialogBareInputClass } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/* A service's settings, on a page (there is no dialog): the whole of
   /services/new, and the Settings section of /services/[id]. On the
   service's page the name, description and roster live above the form
   (service-header.tsx, service-staff.tsx) and never travel through here —
   `updateServiceInput` is strict about it. A create goes back where it
   was asked for — the list, or the member's page that scoped it. */
export function ServiceForm({
  service,
  staff = [],
  forStaffId,
}: {
  service?: ServiceRow;
  /** The roster, for the create page's checklist. */
  staff?: StaffRow[];
  /** A member's page creating a service for that person: no checklist —
      the service is theirs alone, decided by where it was created. */
  forStaffId?: string;
}) {
  const t = useTranslations("services");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const isEdit = Boolean(service);
  const [pending, startTransition] = React.useTransition();
  // Field-level refusal for the one number that has no sane empty value:
  // a cleared field is `Number("") === 0`, which zod's min(1) rejects with
  // the generic "couldn't save" — say which field instead.
  const [windowError, setWindowError] = React.useState<string | null>(null);
  const staffGroupId = React.useId();

  // Solo rule: with one person on the roster there is nothing to choose, so
  // the checklist never appears and `createService` assigns them server-side.
  const activeStaff = staff.filter((s) => s.active);
  const showStaff = !isEdit && !forStaffId && activeStaff.length > 1;
  // A new service is offered by everyone; narrowing is the deliberate act
  // (the same default as staff-form.tsx's service checklist).
  const [staffIds, setStaffIds] = React.useState<Set<string>>(
    () => new Set(activeStaff.map((s) => s.id)),
  );
  // Controlled switches (the one checked-control idiom, ui/switch.tsx) —
  // Base UI's Switch is a button, so the values travel in state, not FormData.
  const [active, setActive] = React.useState(service?.active ?? true);
  const [requiresApproval, setRequiresApproval] = React.useState(service?.requiresApproval ?? false);

  const toggleStaff = (id: string, checked: boolean) =>
    setStaffIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const priceLabel = String(fd.get("priceLabel") ?? "").trim();
    const maxPerDayRaw = String(fd.get("maxPerDay") ?? "").trim();
    const bookingWindowDays = Number(String(fd.get("bookingWindowDays") ?? "").trim());
    if (!Number.isInteger(bookingWindowDays) || bookingWindowDays < 1 || bookingWindowDays > 365) {
      setWindowError(t("form.windowError"));
      return;
    }
    const settings = {
      durationMin: Number(fd.get("durationMin")),
      priceLabel: priceLabel === "" ? undefined : priceLabel,
      bufferBeforeMin: Number(fd.get("bufferBeforeMin")),
      bufferAfterMin: Number(fd.get("bufferAfterMin")),
      minNoticeMin: Number(fd.get("minNoticeMin")),
      maxPerDay: maxPerDayRaw === "" ? null : Number(maxPerDayRaw),
      bookingWindowDays,
      active,
      requiresApproval,
    };
    startTransition(async () => {
      if (service) {
        const result = await updateService({ id: service.id, ...settings });
        if (!result.ok) {
          toastRefusal(result.error, result.upgrade);
          return;
        }
        toast.success(tCommon("saved"));
        return;
      }
      const name = String(fd.get("name") ?? "").trim();
      if (name === "") return;
      const description = String(fd.get("description") ?? "").trim();
      const result = await createService({
        ...settings,
        name,
        description: description === "" ? undefined : description,
        // Omitted when the checklist wasn't rendered: the server then assigns
        // every active member — unless a member's page said whose it is.
        ...(forStaffId ? { staffIds: [forStaffId] } : showStaff ? { staffIds: [...staffIds] } : {}),
      });
      if (!result.ok) {
        toastRefusal(result.error, result.upgrade);
        return;
      }
      toast.success(t("form.created"));
      // A service made from a member's page belongs to that person — go back
      // where the ask came from, not to a list they weren't on.
      router.push(forStaffId ? `/team/${forStaffId}` : "/services");
    });
  };

  return (
    <form onSubmit={onSubmit} className="flex max-w-lg flex-col">
      <div className="flex flex-col">
        {isEdit ? null : (
          <>
            <input
              aria-label={tCommon("name")}
              name="name"
              required
              maxLength={200}
              placeholder={t("form.namePlaceholder")}
              className={cn(dialogBareInputClass, "text-[15px] font-medium")}
              autoFocus
            />
            <textarea
              aria-label={t("form.description")}
              name="description"
              maxLength={2000}
              rows={2}
              placeholder={t("form.descriptionPlaceholder")}
              className={cn(dialogBareInputClass, "mt-3 resize-none text-sm")}
            />
          </>
        )}
        <div className={cn("flex flex-col gap-4", !isEdit && "mt-6")}>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="service-duration">{t("form.duration")}</Label>
              <Input
                id="service-duration"
                name="durationMin"
                type="number"
                required
                min={5}
                max={480}
                defaultValue={service?.durationMin}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="service-price-label">{t("form.priceLabel")}</Label>
              <Input
                id="service-price-label"
                name="priceLabel"
                maxLength={100}
                placeholder={t("form.pricePlaceholder")}
                defaultValue={service?.priceLabel ?? ""}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="service-buffer-before">{t("form.bufferBefore")}</Label>
              <Input
                id="service-buffer-before"
                name="bufferBeforeMin"
                type="number"
                min={0}
                max={240}
                defaultValue={service?.bufferBeforeMin ?? 0}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="service-buffer-after">{t("form.bufferAfter")}</Label>
              <Input
                id="service-buffer-after"
                name="bufferAfterMin"
                type="number"
                min={0}
                max={240}
                defaultValue={service?.bufferAfterMin ?? 0}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="service-min-notice">{t("form.minNotice")}</Label>
              <Input
                id="service-min-notice"
                name="minNoticeMin"
                type="number"
                min={0}
                max={20160}
                defaultValue={service?.minNoticeMin ?? 0}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="service-max-per-day">{t("form.maxPerDay")}</Label>
              <Input
                id="service-max-per-day"
                name="maxPerDay"
                type="number"
                min={1}
                max={100}
                placeholder={t("form.unlimited")}
                defaultValue={service?.maxPerDay ?? ""}
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="service-booking-window">{t("form.bookingWindow")}</Label>
            <Input
              id="service-booking-window"
              name="bookingWindowDays"
              type="number"
              required
              min={1}
              max={365}
              defaultValue={service?.bookingWindowDays ?? 60}
              aria-invalid={windowError !== null || undefined}
              aria-describedby={windowError !== null ? "service-booking-window-error" : undefined}
              onInput={() => setWindowError(null)}
            />
            {windowError ? (
              <p id="service-booking-window-error" className="text-destructive text-xs">
                {windowError}
              </p>
            ) : null}
          </div>
          {showStaff ? (
            // A group heading, not a <label>: a label with nothing to point
            // at is announced as orphaned; the checklist's own labels do the
            // per-row work.
            <div role="group" aria-labelledby={staffGroupId} className="flex flex-col gap-2">
              <p id={staffGroupId} className="text-sm leading-none font-medium">
                {t("form.teamMembers")}
              </p>
              <ul className="flex flex-col gap-1.5">
                {activeStaff.map((person) => (
                  <li key={person.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`service-staff-${person.id}`}
                      checked={staffIds.has(person.id)}
                      onCheckedChange={(checked) => toggleStaff(person.id, checked === true)}
                    />
                    <Label
                      htmlFor={`service-staff-${person.id}`}
                      className="flex items-center gap-2 text-sm font-normal"
                    >
                      <span
                        aria-hidden
                        style={{ background: person.color }}
                        className="size-2.5 shrink-0 rounded-full"
                      />
                      {person.name}
                    </Label>
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground text-xs">{t("form.teamHint")}</p>
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="service-active">{tCommon("active")}</Label>
            <Switch id="service-active" checked={active} onCheckedChange={setActive} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <Label htmlFor="service-requires-approval">{t("form.requireApproval")}</Label>
              <span className="text-muted-foreground text-xs">{t("form.requireApprovalHint")}</span>
            </div>
            <Switch
              id="service-requires-approval"
              checked={requiresApproval}
              onCheckedChange={setRequiresApproval}
            />
          </div>
        </div>
      </div>
      <div className="mt-6">
        <Button type="submit" size="sm" variant="brand" disabled={pending}>
          {pending
            ? isEdit
              ? tCommon("saving")
              : tCommon("creating")
            : isEdit
              ? tCommon("save")
              : t("form.create")}
        </Button>
      </div>
    </form>
  );
}
