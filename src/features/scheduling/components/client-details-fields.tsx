"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// Name/Email/Note, shared by the appointment and rental booking forms.
// Field `name`s stay unprefixed — the enclosing <form> reads them via
// FormData — but `id`s take `idPrefix` so both forms can render on the same
// page (e.g. the widget picker) without colliding label/input pairs.
export function ClientDetailsFields({
  emailOptional = false,
  idPrefix = "",
}: {
  emailOptional?: boolean;
  idPrefix?: string;
}) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}name`}>Name</Label>
        <Input id={`${idPrefix}name`} name="name" required maxLength={200} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}email`}>Email{emailOptional ? " (optional)" : ""}</Label>
        <Input
          id={`${idPrefix}email`}
          name="email"
          type="email"
          required={!emailOptional}
          maxLength={320}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}note`}>Note (optional)</Label>
        <Textarea id={`${idPrefix}note`} name="note" maxLength={2000} rows={3} />
      </div>
    </>
  );
}
