"use client";

export function TopBar({ title }: { title?: string }) {
  return (
    <header className="flex h-12 items-center gap-3 border-b px-4">
      <span className="text-sm font-medium">{title}</span>
    </header>
  );
}
