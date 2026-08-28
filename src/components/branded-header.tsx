/* Shared header for the two token surfaces (/p and /portal) plus the
   BrandingForm settings preview. Pure and server-compatible. /p and /portal
   source branding from getOrgBranding at the call site; the preview sources
   it from getBrandingSettings but overrides the accent with the form's own
   client-regex-validated (not DB CHECK-validated) input while the user is
   typing an unsaved value. Either way the accent is expected to already be
   a #rrggbb hex, safe for inline style. `aside` is the booking page's link
   to its sibling channel page (render/cross-link.tsx); /p and /portal never
   pass it. */
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
  return (
    <div
      className="flex flex-col gap-2 border-b-2 pb-3"
      style={accentColor ? { borderBottomColor: accentColor } : undefined}
    >
      <div className="flex items-center gap-2">
        {logoUrl ? (
          // External Supabase public URL; next/image would need
          // remotePatterns configured for marginal gain on a tiny logo.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={`${orgName} logo`} className="h-6 w-auto max-w-32 object-contain" />
        ) : null}
        <span className="text-sm font-semibold">{orgName}</span>
        {aside ? <span className="ml-auto">{aside}</span> : null}
      </div>
      {subtitle ? <p className="text-muted-foreground text-xs">{subtitle}</p> : null}
    </div>
  );
}
