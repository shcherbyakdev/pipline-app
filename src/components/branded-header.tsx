import { H2 } from "@/features/booking-page/render/type";

/* Shared header for the hosted booking page's Header section, the two token
   surfaces (/p and /portal) and the BrandingForm settings preview. Pure and
   server-compatible. Minimal by ruling (2026-09-06): the org's name in the
   page's display type with the tagline under it, the logo beside it when
   there is one — no disc, no rule, no accent in the chrome; the accent
   belongs to the controls below. `aside` is the booking page's link to its
   sibling channel page (render/cross-link.tsx); /p and /portal never pass
   it. `accentColor` stays in the signature for those callers. */
export function BrandedHeader({
  orgName,
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
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
      {logoUrl ? (
        // External Supabase public URL; next/image would need
        // remotePatterns configured for marginal gain on a tiny logo.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt={`${orgName} logo`} className="h-9 w-auto max-w-36 shrink-0 object-contain" />
      ) : null}
      <div className="min-w-0 flex-1">
        <p className={H2}>{orgName}</p>
        {subtitle ? <p className="text-muted-foreground mt-1 text-sm text-pretty">{subtitle}</p> : null}
      </div>
      {aside ? <div className="shrink-0">{aside}</div> : null}
    </div>
  );
}
