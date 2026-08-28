"use client";

import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsCard } from "@/components/settings-row";
import type { PublicOffering } from "@/lib/booking/public";
import type { OrgMode } from "@/features/orgs/mode";
import { SECTION_META, bookingMeta } from "../defaults";
import { bookingChannel, type Section } from "../schema";
import { HeaderForm } from "./forms/header";
import { HeroForm } from "./forms/hero";
import { AboutForm } from "./forms/about";
import { ServicesForm } from "./forms/services";
import { StaffForm } from "./forms/staff";
import { SpacesForm } from "./forms/spaces";
import { GalleryForm } from "./forms/gallery";
import { TestimonialsForm } from "./forms/testimonials";
import { FaqForm } from "./forms/faq";
import { LinksForm } from "./forms/links";
import { LocationForm } from "./forms/location";
import { BookingForm } from "./forms/booking";

/* The drilled-in left panel: one section's form. `onChange` receives the
   whole next section (replaceSection swaps it by id). */
export function SectionInspector({
  section, issues, supabaseUrl, offerings, mode, singleBooking, onChange, onSplit, onBack,
}: {
  section: Section; issues: Record<string, string>; supabaseUrl: string; offerings: PublicOffering[];
  /** The present mode: the booking form offers a channel choice only when both are sold. */
  mode: OrgMode;
  /** Exactly one booking widget on the page (so its channel may change freely). */
  singleBooking: boolean;
  onChange: (next: Section) => void;
  /** Replace the combined widget with one per channel (splitBookingSection). */
  onSplit: () => void;
  onBack: () => void;
}) {
  const common = { issues, supabaseUrl, onChange };
  const meta = section.type === "booking" ? bookingMeta(bookingChannel(section)) : SECTION_META[section.type];
  const form = (() => {
    switch (section.type) {
      case "header": return <HeaderForm section={section} {...common} />;
      case "hero": return <HeroForm section={section} {...common} />;
      case "about": return <AboutForm section={section} {...common} />;
      case "services": return <ServicesForm section={section} {...common} />;
      case "staff": return <StaffForm section={section} {...common} />;
      case "spaces": return <SpacesForm section={section} offerings={offerings} {...common} />;
      case "gallery": return <GalleryForm section={section} {...common} />;
      case "testimonials": return <TestimonialsForm section={section} {...common} />;
      case "faq": return <FaqForm section={section} {...common} />;
      case "links": return <LinksForm section={section} {...common} />;
      case "location": return <LocationForm section={section} {...common} />;
      case "booking": return <BookingForm section={section} mode={mode} single={singleBooking} onSplit={onSplit} {...common} />;
    }
  })();
  return (
    <div className="flex flex-col gap-3">
      <Button size="xs" variant="ghost" className="w-fit" onClick={onBack}>
        <ChevronLeft className="size-3.5" /> Sections
      </Button>
      <SettingsCard title={meta.label} description={meta.description}>
        {form}
      </SettingsCard>
    </div>
  );
}
