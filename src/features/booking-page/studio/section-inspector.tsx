"use client";

import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsCard } from "@/components/settings-row";
import { SECTION_META } from "../defaults";
import type { Section } from "../schema";
import { HeaderForm } from "./forms/header";
import { HeroForm } from "./forms/hero";
import { AboutForm } from "./forms/about";
import { ServicesForm } from "./forms/services";
import { StaffForm } from "./forms/staff";
import { GalleryForm } from "./forms/gallery";
import { TestimonialsForm } from "./forms/testimonials";
import { FaqForm } from "./forms/faq";
import { LinksForm } from "./forms/links";
import { LocationForm } from "./forms/location";
import { BookingForm } from "./forms/booking";

/* The drilled-in left panel: one section's form. `onChange` receives the
   whole next section (replaceSection swaps it by id). */
export function SectionInspector({
  section, issues, supabaseUrl, onChange, onBack,
}: {
  section: Section; issues: Record<string, string>; supabaseUrl: string;
  onChange: (next: Section) => void; onBack: () => void;
}) {
  const common = { issues, supabaseUrl, onChange };
  const form = (() => {
    switch (section.type) {
      case "header": return <HeaderForm section={section} {...common} />;
      case "hero": return <HeroForm section={section} {...common} />;
      case "about": return <AboutForm section={section} {...common} />;
      case "services": return <ServicesForm section={section} {...common} />;
      case "staff": return <StaffForm section={section} {...common} />;
      case "gallery": return <GalleryForm section={section} {...common} />;
      case "testimonials": return <TestimonialsForm section={section} {...common} />;
      case "faq": return <FaqForm section={section} {...common} />;
      case "links": return <LinksForm section={section} {...common} />;
      case "location": return <LocationForm section={section} {...common} />;
      case "booking": return <BookingForm section={section} {...common} />;
    }
  })();
  return (
    <div className="flex flex-col gap-3">
      <Button size="xs" variant="ghost" className="w-fit" onClick={onBack}>
        <ChevronLeft className="size-3.5" /> Sections
      </Button>
      <SettingsCard title={SECTION_META[section.type].label} description={SECTION_META[section.type].description}>
        {form}
      </SettingsCard>
    </div>
  );
}
