"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AddUnit({
  onAdd,
}: {
  onAdd: (name: string, externalRef?: string) => void;
}) {
  const [name, setName] = React.useState("");
  const [ref, setRef] = React.useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (trimmedName === "") return;
    onAdd(trimmedName, ref || undefined);
    setName("");
    setRef("");
  };

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Add a unit…"
        maxLength={120}
        aria-label="New unit name"
      />
      <Input
        value={ref}
        onChange={(e) => setRef(e.target.value)}
        placeholder="Ref (optional)"
        maxLength={120}
        aria-label="New unit external reference"
        className="w-36"
      />
      <Button type="submit" size="sm" variant="secondary" disabled={name.trim() === ""}>
        <Plus className="size-4" /> Add
      </Button>
    </form>
  );
}
