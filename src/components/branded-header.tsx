/* Shared header for the two token surfaces (/p and /portal). Pure and
   server-compatible; branding comes from getOrgBranding at the call site.
   The accent is a CHECK-validated #rrggbb hex, safe for inline style. */
export function BrandedHeader({
  orgName,
  accentColor,
  logoUrl,
  subtitle,
}: {
  orgName: string;
  accentColor: string | null;
  logoUrl: string | null;
  subtitle?: string;
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
      </div>
      {subtitle ? <p className="text-muted-foreground text-xs">{subtitle}</p> : null}
    </div>
  );
}
