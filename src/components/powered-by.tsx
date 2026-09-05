import { useTranslations } from "next-intl";
import { env } from "@/env";
import { BookloWordmark } from "@/features/marketing/components/booklo-mark";
import { cn } from "@/lib/utils";

/** "Powered by booklo" with the wordmark where the name goes — the landing
    card's own footer line. The message is one translated string; the
    brand name inside it becomes the mark. */
export function PoweredByLabel({ className }: { className?: string }) {
  const t = useTranslations("public");
  const [before, after = ""] = t("poweredBy").split("Booklo");
  return (
    <span className={cn("text-subtle inline-flex items-center gap-1.5 text-xs", className)}>
      {before.trim()}
      <BookloWordmark className="text-foreground text-sm" />
      {after.trim() || null}
    </span>
  );
}

/* The growth loop (spec §5): every public booking surface carries the badge
   unless the org is on a plan that may hide it AND asked to (badgeVisible —
   lib/billing/entitlements.ts holds that rule; this component only renders).
   `?ref=badge&org=` makes the loop measurable: which org sent the visitor. */
export function PoweredBy({ handle }: { handle: string }) {
  return (
    <p className="mt-2 text-center">
      <a
        href={`${env.NEXT_PUBLIC_APP_URL}/?ref=badge&org=${encodeURIComponent(handle)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:text-foreground inline-flex rounded-full px-2 py-1 transition-colors duration-150"
      >
        <PoweredByLabel />
      </a>
    </p>
  );
}
