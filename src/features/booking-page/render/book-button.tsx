import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* The one-click path to booking: a plain anchor (works before hydration) to
   the page's first booking step — the catalogue section when there is one,
   else the widget (bookHref); each target carries `scroll-mt-6`. Preview
   mode renders the same button inert — the studio preview never scrolls,
   and the SectionFrame around it takes the click to select. The cover, the
   nav header and the closing band share it; `inverted` is the band's
   (ground on ink). */
export function BookButton({
  label, href, mode, size = "lg", inverted = false, className,
}: {
  label: string | undefined; href: string; mode: "public" | "preview"; size?: "default" | "lg"; inverted?: boolean; className?: string;
}) {
  const text = label?.trim();
  if (!text) return null;
  const cls = cn(
    buttonVariants({ size }),
    "rounded-[var(--widget-radius)] px-4",
    inverted ? "bg-background text-foreground hover:bg-background/90" : "wt-primary",
    className,
  );
  return mode === "public" ? (
    <a href={href} className={cls}>{text}</a>
  ) : (
    <span aria-disabled className={cn(cls, "cursor-default")}>{text}</span>
  );
}
