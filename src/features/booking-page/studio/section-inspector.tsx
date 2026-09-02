"use client";

import { useTranslations } from "next-intl";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsCard } from "@/components/settings-row";
import type { PublicOffering } from "@/lib/booking/public";
import type { Section } from "../schema";
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
  section, issues, supabaseUrl, offerings, onChange, onBack,
}: {
  section: Section; issues: Record<string, string>; supabaseUrl: string; offerings: PublicOffering[];
  onChange: (next: Section) => void; onBack: () => void;
}) {
  const t = useTranslations("studio");
  const common = { issues, supabaseUrl, onChange };
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
      case "booking": return <BookingForm section={section} {...common} />;
    }
  })();
  return (
    <div className="flex flex-col gap-3">
      <Button size="xs" variant="ghost" className="w-fit" onClick={onBack}>
        <ChevronLeft className="size-3.5" /> {t("tabs.sections")}
      </Button>
      <SettingsCard title={t(`sections.${section.type}.label`)} description={t(`sections.${section.type}.description`)}>
        {form}
      </SettingsCard>
    </div>
  );
}
