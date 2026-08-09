"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AddStage({ onAdd }: { onAdd: (name: string) => void }) {
  const [value, setValue] = React.useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = value.trim();
    if (name === "") return;
    onAdd(name);
    setValue("");
  };

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Add a stage…"
        maxLength={60}
        aria-label="New stage name"
      />
      <Button type="submit" size="sm" variant="secondary" disabled={value.trim() === ""}>
        <Plus className="size-4" /> Add
      </Button>
    </form>
  );
}
