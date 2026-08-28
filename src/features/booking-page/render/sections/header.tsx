import { BrandedHeader } from "@/components/branded-header";
import type { SectionOf } from "../../schema";
import type { RenderContext } from "../context";
import { CrossLink } from "../cross-link";

export function HeaderSection({ section, ctx, crossLink }: { section: SectionOf<"header">; ctx: RenderContext; crossLink: RenderContext["crossLink"] }) {
  // A staff page keeps today's "Booking with X" line; the tagline otherwise.
  const subtitle = ctx.lockedStaff ? `Booking with ${ctx.lockedStaff.name}` : section.tagline.trim() || undefined;
  return (
    <BrandedHeader
      orgName={ctx.org.orgName}
      accentColor={ctx.branding.accentColor}
      logoUrl={ctx.branding.logoUrl}
      subtitle={subtitle}
      aside={<CrossLink link={crossLink} mode={ctx.mode} className="text-xs" />}
    />
  );
}
