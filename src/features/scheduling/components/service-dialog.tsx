"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { toastRefusal } from "@/features/billing/refusal-toast";
import { createService, updateService } from "@/features/scheduling/actions";
import type { ServiceRow } from "@/features/scheduling/queries";
import type { StaffRow } from "@/features/scheduling/staff-queries";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
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

export function ServiceDialog({
  service,
  staff,
  gateHref = null,
  forStaffId,
  trigger,
}: {
  service?: ServiceRow;
  staff: StaffRow[];
  /** Set when the plan would refuse another service (the Team page's rule):
      the create trigger links to the door instead. */
  gateHref?: string | null;
  /** A member's page creating a service for that person: no checklist —
      the service is theirs alone, decided by where it was created. */
  forStaffId?: string;
  /** The create trigger, when the page wants its own (the member page's
      rail row); the default is the "New service" button. */
  trigger?: React.ReactElement;
}) {
  const t = useTranslations("services");
  const tCommon = useTranslations("common");
  const tAppointments = useTranslations("appointments");
  const isEdit = Boolean(service);
  const searchParams = useSearchParams();
  const router = useRouter();
  // Only the create trigger (rendered once, at page level) participates in
  // the `?new=1` URL-driven open — Task 14 links to /services?new=1 to open
  // the create dialog directly. Edit dialogs are per-row and only ever
  // opened manually.
  const urlOpen = !isEdit && searchParams.get("new") === "1";
  const [manuallyOpened, setManuallyOpened] = React.useState(false);
  const open = urlOpen || manuallyOpened;
  const [pending, startTransition] = React.useTransition();
  // Field-level refusal for the one number that has no sane empty value:
  // a cleared field is `Number("") === 0`, which zod's min(1) rejects with
  // the generic "couldn't save" — say which field instead.
  const [windowError, setWindowError] = React.useState<string | null>(null);
  const staffGroupId = React.useId();

  // Solo rule: with one person on the roster there is nothing to choose, so
  // the checklist never appears and `createService` assigns them server-side.
  const activeStaff = staff.filter((s) => s.active);
  // A service created from a member's page is theirs; nothing to choose.
  const showStaff = !forStaffId && activeStaff.length > 1;
  // A new service is offered by everyone; narrowing is the deliberate act
  // (the same default as staff-form.tsx's service checklist). On edit the seed is the
  // stored set, deactivated people included — only active rows are rendered,
  // so someone off the roster keeps their assignment through a save.
  const defaultStaffIds = () =>
    new Set(service ? service.staffIds : activeStaff.map((s) => s.id));
  const [staffIds, setStaffIds] = React.useState<Set<string>>(defaultStaffIds);
  // Controlled switches (the one checked-control idiom, ui/switch.tsx) —
  // Base UI's Switch is a button, so the values travel in state, not FormData.
  const [active, setActive] = React.useState(service?.active ?? true);
  const [requiresApproval, setRequiresApproval] = React.useState(
    service?.requiresApproval ?? false,
  );

  const onOpenChange = (next: boolean) => {
    // The popup unmounts when closed, so the uncontrolled fields reset on
    // reopen — the checklist and switches are state, and have to be put back
    // by hand to match.
    if (next) {
      setStaffIds(defaultStaffIds());
      setActive(service?.active ?? true);
      setRequiresApproval(service?.requiresApproval ?? false);
    }
    setWindowError(null);
    setManuallyOpened(next);
    if (!next && urlOpen) router.replace("/services");
  };

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
    const name = String(fd.get("name") ?? "").trim();
    if (name === "") return;
    const description = String(fd.get("description") ?? "").trim();
    const priceLabel = String(fd.get("priceLabel") ?? "").trim();
    const maxPerDayRaw = String(fd.get("maxPerDay") ?? "").trim();
    const bookingWindowDays = Number(
      String(fd.get("bookingWindowDays") ?? "").trim(),
    );
    if (
      !Number.isInteger(bookingWindowDays) ||
      bookingWindowDays < 1 ||
      bookingWindowDays > 365
    ) {
      setWindowError(t("dialog.windowError"));
      return;
    }
    const payload = {
      name,
      description: description === "" ? undefined : description,
      durationMin: Number(fd.get("durationMin")),
      priceLabel: priceLabel === "" ? undefined : priceLabel,
      bufferBeforeMin: Number(fd.get("bufferBeforeMin")),
      bufferAfterMin: Number(fd.get("bufferAfterMin")),
      minNoticeMin: Number(fd.get("minNoticeMin")),
      maxPerDay: maxPerDayRaw === "" ? null : Number(maxPerDayRaw),
      bookingWindowDays,
      active,
      requiresApproval,
      // Omitted when the checklist wasn't rendered: the server then keeps the
      // existing links (edit) or assigns every active member (create) — unless
      // a member's page said whose it is.
      ...(forStaffId ? { staffIds: [forStaffId] } : showStaff ? { staffIds: [...staffIds] } : {}),
    };
    startTransition(async () => {
      const result = isEdit
        ? await updateService({ id: service!.id, ...payload })
        : await createService(payload);
      if (!result.ok) {
        toastRefusal(result.error, result.upgrade);
        return;
      }
      onOpenChange(false);
      toast.success(isEdit ? tCommon("saved") : t("dialog.created"));
    });
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
            <Button size="sm" variant="outline">
              <Pencil className="size-4" /> {tCommon("edit")}
            </Button>
          ) : (
            (trigger ?? (
              <Button size="sm">
                <Plus className="size-4" /> {t("newButton")}
              </Button>
            ))
          )
        }
      />
      <DialogContent className={cn(dialogPanelClass, "sm:max-w-lg")}>
        <DialogBreadcrumbHeader
          chip={<DialogChip tone="time">{tAppointments("field")}</DialogChip>}
        >
          {isEdit ? t("dialog.editTitle") : t("newButton")}
        </DialogBreadcrumbHeader>
        <form onSubmit={onSubmit} className="flex flex-col">
          <div className="flex flex-col px-5 pt-4 pb-6">
            <input
              aria-label={tCommon("name")}
              name="name"
              required
              maxLength={200}
              defaultValue={service?.name}
              placeholder={t("dialog.namePlaceholder")}
              className={cn(dialogBareInputClass, "text-[15px] font-medium")}
              autoFocus
            />
            <textarea
              aria-label={t("dialog.description")}
              name="description"
              maxLength={2000}
              rows={2}
              defaultValue={service?.description ?? ""}
              placeholder={t("dialog.descriptionPlaceholder")}
              className={cn(dialogBareInputClass, "mt-3 resize-none text-sm")}
            />
            <div className="mt-6 flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="service-duration">{t("dialog.duration")}</Label>
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
                  <Label htmlFor="service-price-label">{t("dialog.priceLabel")}</Label>
                  <Input
                    id="service-price-label"
                    name="priceLabel"
                    maxLength={100}
                    placeholder={t("dialog.pricePlaceholder")}
                    defaultValue={service?.priceLabel ?? ""}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="service-buffer-before">{t("dialog.bufferBefore")}</Label>
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
                  <Label htmlFor="service-buffer-after">{t("dialog.bufferAfter")}</Label>
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
                  <Label htmlFor="service-min-notice">{t("dialog.minNotice")}</Label>
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
                  <Label htmlFor="service-max-per-day">{t("dialog.maxPerDay")}</Label>
                  <Input
                    id="service-max-per-day"
                    name="maxPerDay"
                    type="number"
                    min={1}
                    max={100}
                    placeholder={t("dialog.unlimited")}
                    defaultValue={service?.maxPerDay ?? ""}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="service-booking-window">{t("dialog.bookingWindow")}</Label>
                <Input
                  id="service-booking-window"
                  name="bookingWindowDays"
                  type="number"
                  required
                  min={1}
                  max={365}
                  defaultValue={service?.bookingWindowDays ?? 60}
                  aria-invalid={windowError !== null || undefined}
                  aria-describedby={
                    windowError !== null
                      ? "service-booking-window-error"
                      : undefined
                  }
                  onInput={() => setWindowError(null)}
                />
                {windowError ? (
                  <p
                    id="service-booking-window-error"
                    className="text-destructive text-xs"
                  >
                    {windowError}
                  </p>
                ) : null}
              </div>
              {showStaff ? (
                // A group heading, not a <label>: a label with nothing to point
                // at is announced as orphaned; the checklist's own labels do the
                // per-row work.
                <div
                  role="group"
                  aria-labelledby={staffGroupId}
                  className="flex flex-col gap-2"
                >
                  <p
                    id={staffGroupId}
                    className="text-sm leading-none font-medium"
                  >
                    {t("dialog.teamMembers")}
                  </p>
                  <ul className="flex flex-col gap-1.5">
                    {activeStaff.map((person) => (
                      <li key={person.id} className="flex items-center gap-2">
                        <Checkbox
                          id={`service-staff-${person.id}`}
                          checked={staffIds.has(person.id)}
                          onCheckedChange={(checked) =>
                            toggleStaff(person.id, checked === true)
                          }
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
                  <p className="text-muted-foreground text-xs">{t("dialog.teamHint")}</p>
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="service-active">{tCommon("active")}</Label>
                <Switch
                  id="service-active"
                  checked={active}
                  onCheckedChange={setActive}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col">
                  <Label htmlFor="service-requires-approval">{t("dialog.requireApproval")}</Label>
                  <span className="text-muted-foreground text-xs">{t("dialog.requireApprovalHint")}</span>
                </div>
                <Switch
                  id="service-requires-approval"
                  checked={requiresApproval}
                  onCheckedChange={setRequiresApproval}
                />
              </div>
            </div>
          </div>
          <DialogFooterBar>
            <Button type="submit" size="sm" variant="brand" disabled={pending}>
              {pending
                ? isEdit
                  ? tCommon("saving")
                  : tCommon("creating")
                : isEdit
                  ? tCommon("save")
                  : t("dialog.create")}
            </Button>
          </DialogFooterBar>
        </form>
      </DialogContent>
    </Dialog>
  );
}
