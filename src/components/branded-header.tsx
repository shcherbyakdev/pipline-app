import { cn } from "@/lib/utils";

/* Shared header for the hosted booking page's Header section, the two token
   surfaces (/p and /portal) and the BrandingForm settings preview. Pure and
   server-compatible. The org's identity block, as the landing's hero card
   draws it (2026-09-06): a disc with the logo or the initial, the name at
   17px medium, the tagline as secondary text. The accent lives on the disc
   (a fill with a white letter, like every accent control on the page); no
   accent rule under the header — the page panel carries the structure.
   `aside` is the booking page's link to its sibling channel page
   (render/cross-link.tsx); /p and /portal never pass it. The accent is
   expected to already be a #rrggbb hex, safe for inline style. */
export function BrandedHeader({
  orgName,
  accentColor,
  logoUrl,
  subtitle,
  aside,
}: {
  orgName: string;
  accentColor: string | null;
  logoUrl: string | null;
  subtitle?: string;
  aside?: React.ReactNode;
}) {
  // Array.from: the first CHARACTER, not the first UTF-16 unit (an org
  // named "🌿 Green Room" must not show a lone surrogate).
  const initial = Array.from(orgName.trim())[0]?.toUpperCase() ?? "";
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
      {logoUrl ? (
        // External Supabase public URL; next/image would need
        // remotePatterns configured for marginal gain on a tiny logo.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt={`${orgName} logo`} className="h-11 w-auto max-w-40 shrink-0 object-contain" />
      ) : (
        <span
          aria-hidden
          // wt-r2: the widget theme squares every `rounded` to r; the disc
          // takes the card radius. Ink when the org has no accent.
          className={cn(
            "wt-r2 flex size-11 shrink-0 items-center justify-center rounded-2xl text-lg font-semibold",
            accentColor ? "text-white" : "bg-primary text-primary-foreground",
          )}
          style={accentColor ? { background: accentColor } : undefined}
        >
          {initial}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[17px] leading-tight font-medium text-balance">{orgName}</p>
        {subtitle ? <p className="text-muted-foreground mt-0.5 text-sm text-pretty">{subtitle}</p> : null}
      </div>
      {aside ? <div className="shrink-0">{aside}</div> : null}
    </div>
  );
}
