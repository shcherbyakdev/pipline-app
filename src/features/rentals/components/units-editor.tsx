"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/features/scheduling/components/date-picker";
import {
  createUnit,
  updateUnit,
  deleteUnit,
  addBlackout,
  deleteBlackout,
} from "@/features/rentals/actions";
import type { UnitRow, BlackoutRow } from "@/features/rentals/queries";
import { INTL_LOCALES } from "@/i18n/config";

type UnitWithBlackouts = UnitRow & { blackouts: BlackoutRow[] };

function formatDate(date: string, intlLocale: string): string {
  // Noon UTC keeps the rendered day from sliding across a boundary in
  // negative-offset timezones (date-overrides.tsx makes the same call).
  // The locale is the app's, never `undefined`: that let the server's and
  // browser's locales disagree — a hydration mismatch on every blackout row.
  return new Intl.DateTimeFormat(intlLocale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

export function UnitsEditor({
  offeringId,
  units,
}: {
  offeringId: string;
  units: UnitWithBlackouts[];
}) {
  const t = useTranslations("spaces");
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold">{t("units.title")}</h2>
        <p className="text-muted-foreground text-xs">{t("unitsHint")}</p>
      </div>

      <AddUnitForm offeringId={offeringId} />

      {units.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("unitsEmpty")}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {units.map((unit) => (
            // Keyed remount: a successful save re-renders with fresh server
            // data and the new key re-derives the card's local field state —
            // the project's alternative to syncing state in an effect
            // (see features/README.md). The key carries exactly the two
            // columns those fields derive from; `active` is deliberately
            // absent, so toggling the checkbox mid-edit leaves typed text
            // standing instead of remounting it away.
            <UnitCard
              key={`${unit.id}:${unit.name}:${unit.description ?? ""}`}
              offeringId={offeringId}
              unit={unit}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function AddUnitForm({ offeringId }: { offeringId: string }) {
  const t = useTranslations("spaces.units");
  const tc = useTranslations("common");
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (trimmedName === "") return;
    const trimmedDescription = description.trim();
    startTransition(async () => {
      const result = await createUnit({
        offeringId,
        name: trimmedName,
        description: trimmedDescription === "" ? undefined : trimmedDescription,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setName("");
      setDescription("");
      toast.success(t("added"));
    });
  };

  return (
    <form onSubmit={onSubmit} className="flex items-center gap-2">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("namePlaceholder")}
        maxLength={200}
        aria-label={t("newNameAria")}
      />
      <Input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={t("descriptionPlaceholder")}
        maxLength={2000}
        aria-label={t("newDescriptionAria")}
      />
      <Button type="submit" size="sm" variant="secondary" disabled={pending || name.trim() === ""}>
        <Plus /> {tc("add")}
      </Button>
    </form>
  );
}

function UnitCard({ offeringId, unit }: { offeringId: string; unit: UnitWithBlackouts }) {
  const t = useTranslations("spaces.units");
  const tc = useTranslations("common");
  const [name, setName] = React.useState(unit.name);
  const [description, setDescription] = React.useState(unit.description ?? "");
  const [pending, startTransition] = React.useTransition();

  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  const dirty = trimmedName !== unit.name || trimmedDescription !== (unit.description ?? "");

  // updateUnit writes the whole row, so both paths have to name every column.
  // What they must not share is whose text they send: `saveEdits` publishes the
  // edited fields, while `setActive` re-sends the server's last-known name and
  // description — flipping the checkbox must never commit half-typed text as a
  // side effect.
  const write = (
    fields: { name: string; description: string | null; active: boolean },
    message: string,
  ) => {
    startTransition(async () => {
      const result = await updateUnit({
        id: unit.id,
        offeringId,
        name: fields.name,
        description: fields.description ?? undefined,
        active: fields.active,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(message);
    });
  };

  const saveEdits = () => {
    if (trimmedName === "") {
      toast.error(t("needsName"));
      return;
    }
    write(
      {
        name: trimmedName,
        description: trimmedDescription === "" ? null : trimmedDescription,
        active: unit.active,
      },
      tc("saved"),
    );
  };

  const setActive = (active: boolean) =>
    write(
      { name: unit.name, description: unit.description, active },
      active ? t("activated") : t("deactivated"),
    );

  const onDelete = () => {
    startTransition(async () => {
      const result = await deleteUnit({ id: unit.id, offeringId });
      if (!result.ok) {
        // Includes the FK-restrict copy: "It has bookings — deactivate it instead."
        toast.error(result.error);
        return;
      }
      toast.success(t("deleted"));
    });
  };

  const nameId = `unit-${unit.id}-name`;
  const descriptionId = `unit-${unit.id}-description`;

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-40 flex-1 flex-col gap-1.5">
          <Label htmlFor={nameId} className="text-muted-foreground text-xs">
            {tc("name")}
          </Label>
          <Input
            id={nameId}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
          />
        </div>
        <div className="flex min-w-40 flex-1 flex-col gap-1.5">
          <Label htmlFor={descriptionId} className="text-muted-foreground text-xs">
            {t("description")}
          </Label>
          <Input
            id={descriptionId}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
          />
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pending || !dirty}
          onClick={saveEdits}
        >
          {tc("save")}
        </Button>
      </div>

      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={unit.active}
            disabled={pending}
            onCheckedChange={(checked) => setActive(checked === true)}
          />
          {tc("active")}
        </label>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          aria-label={t("deleteAria", { name: unit.name })}
          onClick={onDelete}
        >
          <Trash2 /> {tc("delete")}
        </Button>
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <h3 className="text-muted-foreground text-xs font-medium">{t("blackouts.title")}</h3>
        {unit.blackouts.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {unit.blackouts.map((blackout) => (
              <BlackoutItem key={blackout.id} offeringId={offeringId} blackout={blackout} />
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-xs">{t("blackouts.none")}</p>
        )}
        <AddBlackoutForm offeringId={offeringId} unitId={unit.id} />
      </div>
    </li>
  );
}

function BlackoutItem({
  offeringId,
  blackout,
}: {
  offeringId: string;
  blackout: BlackoutRow;
}) {
  const t = useTranslations("spaces.units.blackouts");
  const intlLocale = INTL_LOCALES[useLocale()];
  const [pending, startTransition] = React.useTransition();
  const label = `${formatDate(blackout.startDate, intlLocale)} → ${formatDate(blackout.endDate, intlLocale)}`;

  const onDelete = () => {
    startTransition(async () => {
      const result = await deleteBlackout({ id: blackout.id, offeringId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("freed"));
    });
  };

  return (
    <li className="flex items-center justify-between gap-2">
      <span className="text-sm">
        {label}
        {blackout.reason ? (
          <span className="text-muted-foreground"> · {blackout.reason}</span>
        ) : null}
      </span>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        disabled={pending}
        aria-label={t("removeAria", { range: label })}
        onClick={onDelete}
      >
        <Trash2 />
      </Button>
    </li>
  );
}

function AddBlackoutForm({ offeringId, unitId }: { offeringId: string; unitId: string }) {
  const t = useTranslations("spaces.units.blackouts");
  const te = useTranslations("errors");
  const [startDate, setStartDate] = React.useState("");
  const [endDate, setEndDate] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (startDate === "" || endDate === "") return;
    // ISO dates compare lexicographically; the server refuses this too.
    if (endDate < startDate) {
      toast.error(te("spaces.blackoutOrder"));
      return;
    }
    const trimmedReason = reason.trim();
    startTransition(async () => {
      const result = await addBlackout({
        offeringId,
        rentalUnitId: unitId,
        startDate,
        endDate,
        reason: trimmedReason === "" ? undefined : trimmedReason,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setStartDate("");
      setEndDate("");
      setReason("");
      toast.success(t("blocked"));
    });
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
      <DatePicker
        label={t("from")}
        value={startDate}
        onCommit={setStartDate}
      />
      <span aria-hidden="true" className="text-muted-foreground text-sm">
        →
      </span>
      <DatePicker
        label={t("until")}
        value={endDate}
        min={startDate || undefined}
        onCommit={setEndDate}
      />
      <Input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={t("reasonPlaceholder")}
        maxLength={500}
        aria-label={t("reason")}
        className="min-w-32 flex-1"
      />
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={pending || startDate === "" || endDate === ""}
      >
        <Plus /> {t("block")}
      </Button>
    </form>
  );
}
