import { cn } from "@/lib/utils";

/* Small uppercase mono label that opens every section — the one place the
   accent appears in running text. */
export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("text-highlight font-mono text-[11px] tracking-[0.14em] uppercase", className)}>{children}</p>;
}

/* Eyebrow → heading on the left, the sub-line on the right at lg+ (the two
   columns share a baseline), stacked below. Sections that don't need a
   sub-line just omit it and the grid collapses to one column. */
export function SectionHeader({
  id,
  eyebrow,
  heading,
  sub,
  className,
}: {
  id: string;
  eyebrow: string;
  heading: string;
  sub?: string;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-end lg:gap-12", className)}>
      <div>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h2
          id={id}
          className="text-foreground mt-4 max-w-2xl text-[32px] leading-[1.08] font-medium tracking-[-0.03em] text-balance sm:text-4xl md:text-[44px]"
        >
          {heading}
        </h2>
      </div>
      {sub ? <p className="text-muted-foreground max-w-md text-base leading-relaxed lg:pb-1.5 lg:text-[17px]">{sub}</p> : null}
    </div>
  );
}
