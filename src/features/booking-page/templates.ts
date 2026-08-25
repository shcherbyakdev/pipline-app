// Starter compositions. Section text here is SAMPLE COPY for the picker's
// live thumbnails; applyTemplate strips it so nobody publishes "Hair & colour
// by Anna" by accident. Thumbnails never carry images (no storage paths to
// maintain) — the ghost boxes read fine at thumbnail scale.
import type { OrgMode } from "@/features/orgs/mode";
import type { WidgetThemeConfig } from "@/lib/widget-theme";
import { newSection, newSectionId } from "./defaults";
import type { PageDocument, Section, SectionOf, SectionType } from "./schema";

export type TemplateSkin = Pick<WidgetThemeConfig, "theme" | "radius" | "font">;
export type Template = {
  id: string;
  name: string;
  description: string;
  layout: PageDocument["layout"];
  sections: Section[];
  skin?: TemplateSkin;
};

function s<T extends SectionType>(type: T, id: string, props: Partial<Omit<SectionOf<T>, "id" | "type" | "hidden">> = {}): Section {
  return { ...newSection(type, id), ...props } as Section;
}

export const TEMPLATES: readonly Template[] = [
  {
    id: "classic",
    name: "Classic",
    description: "Your name and the booking widget. Today's page.",
    layout: "column",
    sections: [s("header", "tplhdr001"), s("booking", "tplbook01")],
  },
  {
    id: "profile",
    name: "Profile",
    description: "A link-in-bio page: who you are, what you offer, where to find you.",
    layout: "column",
    sections: [
      s("header", "tplhdr002", { tagline: "Colour specialist · Kraków" }),
      s("about", "tplabt002", { title: "Hi, I'm Anna", body: "Fifteen years of colour, cuts and calm. Book a time below — first visits include a free consultation." }),
      s("services", "tplsvc002", { style: "list" }),
      s("links", "tpllnk002", { items: [
        { label: "Instagram", url: "https://instagram.com/anna.hair", icon: "instagram" },
        { label: "WhatsApp", url: "https://wa.me/48600000000", icon: "whatsapp" },
      ] }),
      s("booking", "tplbook02", { title: "Book a time" }),
    ],
    skin: { theme: "light", radius: "round", font: "lora" },
  },
  {
    id: "studio",
    name: "Studio",
    description: "Cover, service cards with prices, gallery and testimonials.",
    layout: "column",
    sections: [
      s("hero", "tplhero03", { headline: "Hair & colour by Anna", subheadline: "A small studio in Kazimierz. Balayage, precision cuts, colour correction.", align: "center" }),
      s("services", "tplsvc003", { style: "cards" }),
      s("gallery", "tplgal003", { columns: 3 }),
      s("testimonials", "tpltst003", { items: [
        { quote: "The only person I trust with my colour.", author: "Marta K." },
        { quote: "Booked in two taps, walked out glowing.", author: "Ola W." },
      ] }),
      s("booking", "tplbook03", { title: "Book a time" }),
      s("location", "tplloc003", { address: "ul. Józefa 12\n31-056 Kraków", mapsUrl: "https://maps.app.goo.gl/example" }),
    ],
    skin: { theme: "dark", radius: "subtle", font: "space-grotesk" },
  },
  {
    id: "venue",
    name: "Venue",
    description: "Photo-led cover, your spaces with prices, a gallery and where to find you.",
    layout: "column",
    sections: [
      s("hero", "tplhero07", { headline: "Rooms by the hour in Podgórze", subheadline: "Rehearsal, recording and workshop space. Pick a room, choose your hours, book online.", align: "center" }),
      s("spaces", "tplspc007", { style: "cards" }),
      s("gallery", "tplgal007", { columns: 3 }),
      s("location", "tplloc007", { address: "ul. Józefa 12\n31-056 Kraków", mapsUrl: "https://maps.app.goo.gl/example" }),
      s("booking", "tplbook07", { title: "Book a space" }),
      s("faq", "tplfaq007", { items: [
        { q: "Can I cancel?", a: "Yes — see the cancellation window on each space." },
        { q: "What's included?", a: "The room, the listed gear, and the door code by email." },
      ] }),
    ],
    skin: { theme: "light", radius: "subtle", font: "system" },
  },
  {
    id: "split",
    name: "Split",
    description: "Story on the left, booking pinned on the right.",
    layout: "split",
    sections: [
      s("hero", "tplhero04", { headline: "Physiotherapy that gets you moving", subheadline: "One-to-one sessions, no waiting room." }),
      s("about", "tplabt004", { title: "About the practice", body: "Sports rehab, posture and pain management.\n\nEvery plan starts with a full assessment." }),
      s("services", "tplsvc004", { style: "list" }),
      s("faq", "tplfaq004", { items: [
        { q: "Do I need a referral?", a: "No — book directly." },
        { q: "What should I bring?", a: "Comfortable clothes and any recent scans." },
      ] }),
      s("location", "tplloc004", { address: "Aleja Pokoju 5\n31-548 Kraków" }),
      s("booking", "tplbook04", { title: "Book a session" }),
    ],
    skin: { theme: "light", radius: "subtle", font: "dm-sans" },
  },
  {
    id: "team",
    name: "Team",
    description: "Your people first, then services and booking.",
    layout: "column",
    sections: [
      s("header", "tplhdr005", { tagline: "Barbers since 2015" }),
      s("staff", "tplstf005", { title: "Pick your barber" }),
      s("services", "tplsvc005", { style: "list" }),
      s("booking", "tplbook05", { title: "Book a chair" }),
      s("location", "tplloc005", { address: "ul. Długa 3\n31-147 Kraków" }),
    ],
    skin: { theme: "light", radius: "subtle", font: "inter" },
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "A headline, the widget, your links. Nothing else.",
    layout: "column",
    sections: [
      s("hero", "tplhero06", { headline: "Book a tutoring session", subheadline: "Maths & physics, online or in Kraków.", align: "center" }),
      s("booking", "tplbook06"),
      s("links", "tpllnk006", { items: [{ label: "Email me", url: "mailto:hello@example.com", icon: "email" }] }),
    ],
    skin: { theme: "light", radius: "none", font: "system" },
  },
];

/** Fresh id, sample copy gone, list shapes kept (one empty row per sample
    item), live-section titles kept — they are labels, not sample copy. */
export function stripSample(section: Section): Section {
  const base = { ...section, id: newSectionId() } as Section;
  switch (base.type) {
    case "header": return { ...base, tagline: "" };
    case "hero": {
      const next = { ...base, headline: "", subheadline: "" };
      delete next.imagePath;
      return next;
    }
    case "about": {
      const next = { ...base, title: "", body: "" };
      delete next.photoPath;
      return next;
    }
    case "gallery": return { ...base, images: [] };
    case "testimonials": return { ...base, items: base.items.map(() => ({ quote: "", author: "" })) };
    case "faq": return { ...base, items: base.items.map(() => ({ q: "", a: "" })) };
    case "links": return { ...base, items: base.items.map((i) => ({ label: "", url: "", icon: i.icon })) };
    case "location": return { ...base, address: "", mapsUrl: "" };
    case "services":
    case "staff":
    case "spaces":
    case "booking":
      return base;
  }
}

function spacesFrom(services: SectionOf<"services">, id: string): Section {
  return { ...newSection("spaces", id), style: services.style, title: "Spaces" } as Section;
}

/** Make a template's sections fit what the org sells: a rentals-only org
    gets Spaces where the template had Services (and no Team); a mixed org
    gets Spaces right after Services; an appointments-only org never sees
    Spaces. `idFor` names the sections this creates — fresh for applying,
    derived-and-stable for thumbnails. */
export function fitToMode(sections: Section[], mode: OrgMode, idFor: (source: Section) => string): Section[] {
  const out: Section[] = [];
  for (const section of sections) {
    if (section.type === "services") {
      if (mode.offersAppointments) {
        out.push(section);
        if (mode.offersRentals) out.push({ ...newSection("spaces", idFor(section)), style: "cards" } as Section);
      } else if (mode.offersRentals) {
        out.push(spacesFrom(section, idFor(section)));
      }
      continue;
    }
    if (section.type === "staff" && !mode.offersAppointments) continue;
    if (section.type === "spaces" && !mode.offersRentals) continue;
    out.push(section);
  }
  return out;
}

export function applyTemplate(t: Template, mode: OrgMode): PageDocument {
  return { version: 1, layout: t.layout, sections: fitToMode(t.sections, mode, () => newSectionId()).map(stripSample) };
}

/** The thumbnail document: sample copy intact, ids stable across renders. */
export function templatePreview(t: Template, mode: OrgMode): PageDocument {
  return { version: 1, layout: t.layout, sections: fitToMode(t.sections, mode, (s) => ("sp" + s.id).slice(0, 12)) };
}

/** Picker order per mode: Venue leads for space owners, hides for appointment-only orgs. */
export function templatesFor(mode: OrgMode): Template[] {
  const venue = TEMPLATES.filter((t) => t.id === "venue");
  const rest = TEMPLATES.filter((t) => t.id !== "venue");
  if (!mode.offersRentals) return rest;
  if (!mode.offersAppointments) return [...venue, ...rest];
  return [...TEMPLATES];
}
