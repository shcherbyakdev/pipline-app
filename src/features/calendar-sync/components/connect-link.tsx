import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* The Connect / Reconnect control: a plain anchor on purpose. The route
   302s to Google's consent page, so it must be a top-level navigation —
   a <Link> would prefetch it (setting the nonce cookie and starting an
   OAuth flow on hover) and then hard-navigate anyway. */
export function ConnectLink({ label, variant = "brand" }: { label: string; variant?: "brand" | "outline" }) {
  return (
    // eslint-disable-next-line @next/next/no-html-link-for-pages -- OAuth hop, see above
    <a href="/api/google/start" className={cn(buttonVariants({ variant, size: "sm" }))}>
      {label}
    </a>
  );
}
