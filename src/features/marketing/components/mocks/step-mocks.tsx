import { Check, Copy, Link2, Mail } from "lucide-react";
import { SITE } from "@/features/marketing/site";
import { cn } from "@/lib/utils";

/* One small fragment per "How it works" step, drawn in the card's sand
   header. Static fixtures, decorative (the header is aria-hidden). */

const SLUG = SITE.name.toLowerCase();
const chip = "bg-card ring-border rounded-lg ring-1 shadow-[0_1px_2px_rgb(26_34_56/0.05)]";
const DOW = ["M", "T", "W", "T", "F", "S", "S"];

/* 01 — a service, a space, and the week's hours. */
function ServicesAndHours() {
  return (
    <div className="flex flex-col gap-2 p-4 pt-10">
      {[
        ["Consultation", "30 min"],
        ["Studio A", "by the hour"],
      ].map(([name, length], i) => (
        <div key={name} className={cn(chip, "flex items-center justify-between px-3 py-2 text-xs", i === 0 && "ring-highlight")}>
          <span className="font-medium">{name}</span>
          <span className="text-muted-foreground">{length}</span>
        </div>
      ))}
      <div className="mt-1 flex items-center gap-1.5">
        {DOW.map((d, i) => (
          <span
            key={i}
            className={cn(
              "flex size-6 items-center justify-center rounded-md text-[10px] font-medium",
              i < 5 ? "bg-highlight text-primary-foreground" : "bg-card text-muted-foreground ring-border ring-1",
            )}
          >
            {d}
          </span>
        ))}
        <span className="text-muted-foreground ml-auto font-mono text-[10px]">9:00–17:00</span>
      </div>
    </div>
  );
}

/* 02 — the link, and the one line that embeds it. */
function ShareOrEmbed() {
  return (
    <div className="flex flex-col gap-2 p-4 pt-10">
      <div className={cn(chip, "flex items-center gap-2 px-3 py-2 font-mono text-[11px]")}>
        <Link2 className="text-highlight size-3.5 shrink-0" />
        <span className="truncate">{SLUG}.co/anna-studio</span>
        <Copy className="text-muted-foreground ml-auto size-3.5 shrink-0" />
      </div>
      <div className={cn(chip, "truncate px-3 py-2 font-mono text-[11px] leading-5")}>
        <span className="text-muted-foreground">{"<script "}</span>
        <span className="text-highlight">{`src="https://${SLUG}.co/embed.js"`}</span>
        <span className="text-muted-foreground">{" …>"}</span>
      </div>
    </div>
  );
}

/* 03 — the confirmation, and the email that went to both sides. */
function Confirmed() {
  return (
    <div className="p-4 pt-10">
      <div className={cn(chip, "p-3")}>
        <div className="flex items-center gap-2.5">
          <span className="bg-highlight/12 text-highlight flex size-7 shrink-0 items-center justify-center rounded-full">
            <Check className="size-3.5" strokeWidth={3} />
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] leading-tight font-medium">Booking confirmed</span>
            <span className="text-muted-foreground block truncate text-[11px]">Mia Novak · Fri 21 Aug, 10:30</span>
          </span>
        </div>
        <div className="border-border text-muted-foreground mt-3 flex items-center gap-2 border-t pt-2.5 text-[11px]">
          <Mail className="size-3.5 shrink-0" />
          Email sent to you and Mia
        </div>
      </div>
    </div>
  );
}

export function StepMock({ n }: { n: number }) {
  if (n === 1) return <ServicesAndHours />;
  if (n === 2) return <ShareOrEmbed />;
  return <Confirmed />;
}
