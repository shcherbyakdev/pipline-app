"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Input } from "@/components/ui/input";

export type ClientRow = { id: string; name: string; email: string | null; bookingCount: number };

/* The directory list, with a name/email filter once it's long enough to
   need one — below that the search box would be furniture. */
const SEARCH_FROM = 8;

export function ClientsDirectory({ clients }: { clients: ClientRow[] }) {
  const t = useTranslations("clients.directory");
  const [query, setQuery] = React.useState("");
  const q = query.trim().toLowerCase();
  const shown = q
    ? clients.filter((c) => c.name.toLowerCase().includes(q) || (c.email ?? "").toLowerCase().includes(q))
    : clients;

  return (
    <div className="flex flex-col gap-3">
      {clients.length >= SEARCH_FROM ? (
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchAria")}
          className="max-w-xs"
        />
      ) : null}
      {shown.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("noMatch", { query: query.trim() })}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((c) => (
            <li key={c.id}>
              <Link
                href={`/clients/${c.id}`}
                className="bg-card hover:bg-accent/40 flex items-center gap-3 rounded-xl border px-4 py-3 text-sm transition-colors duration-150 ease-strong"
              >
                <span className="min-w-0 truncate font-medium">{c.name}</span>
                {c.email ? (
                  <span className="text-muted-foreground min-w-0 truncate text-xs">{c.email}</span>
                ) : null}
                <span className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums">
                  {t("bookingCount", { count: c.bookingCount })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
