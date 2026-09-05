import Link from "next/link";

/* The small "Premium" pill beside a control a plan withholds. With a door
   (upgradeHref) it is a link to it; without one it is a plain label. The
   control names it via aria-describedby. */
export function PremiumChip({ id, href, label }: { id: string; href: string | null; label: string }) {
  const className = "border-brand/40 text-brand-text rounded-full border px-1.5 py-0.5 text-[10px] font-medium";
  return href ? (
    <Link id={id} href={href} className={`${className} hover:bg-brand/10`}>
      {label}
    </Link>
  ) : (
    <span id={id} className={className}>
      {label}
    </span>
  );
}
