"use client";

import { MobileNav } from "./mobile-nav";

export function TopBar({
  org,
  userEmail,
  title,
}: {
  org: string;
  userEmail: string;
  title?: string;
}) {
  return (
    <header className="flex h-12 items-center gap-3 border-b px-4">
      <MobileNav org={org} userEmail={userEmail} />
      <span className="text-sm font-medium">{title}</span>
    </header>
  );
}
