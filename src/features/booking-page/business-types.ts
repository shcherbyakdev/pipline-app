import type { OrgMode } from "@/features/orgs/mode";
import type { PageChannel } from "./channel";
import type { PageDocument, Section } from "./schema";
import { TEMPLATES, applyTemplate, templatePreview, type Template } from "./templates";

/* The starter's cards (spec 2026-08-28 §5.2). A type is a business the
   owner recognises — "Salon & beauty", not "Studio template" — mapped 1:1
   onto an existing template plus the two words the page needs from it:
   the widget's title and the cover's Book button. Not persisted: apply is
   a one-shot mapping, and the document is what lives on. Order here is
   the card order; each channel ends in its "Something else". */
export type BusinessType = {
  id: string;
  channel: PageChannel;
  name: string;
  examples: string;
  templateId: Template["id"];
  copy: { bookingTitle: string; cta?: string };
};

export const BUSINESS_TYPES: readonly BusinessType[] = [
  { id: "solo", channel: "appointments", name: "Solo practitioner", examples: "coach, therapist, consultant", templateId: "profile", copy: { bookingTitle: "Book a time", cta: "Book now" } },
  { id: "salon", channel: "appointments", name: "Salon & beauty", examples: "hair, nails, brows, tattoo", templateId: "studio", copy: { bookingTitle: "Book a time", cta: "Book now" } },
  { id: "clinic", channel: "appointments", name: "Clinic & practice", examples: "physio, massage, dentist", templateId: "split", copy: { bookingTitle: "Book a session", cta: "Book a session" } },
  { id: "team", channel: "appointments", name: "Team & shop", examples: "barbershop, multi-chair salon", templateId: "team", copy: { bookingTitle: "Book a chair", cta: "Book now" } },
  { id: "online", channel: "appointments", name: "Online & lessons", examples: "tutoring, classes, remote", templateId: "minimal", copy: { bookingTitle: "Book a lesson", cta: "Book now" } },
  { id: "rooms", channel: "spaces", name: "Rooms, studios & gear", examples: "by the hour", templateId: "venue", copy: { bookingTitle: "Book a space", cta: "Book a space" } },
  { id: "stays", channel: "spaces", name: "Stays", examples: "nights & days", templateId: "stay", copy: { bookingTitle: "Book a stay", cta: "Book a stay" } },
  // Classic: a name and the widget — no cover, so no button.
  { id: "other-appointments", channel: "appointments", name: "Something else", examples: "a name and the widget", templateId: "classic", copy: { bookingTitle: "Book a time" } },
  { id: "other-spaces", channel: "spaces", name: "Something else", examples: "a name and the widget", templateId: "classic", copy: { bookingTitle: "Book a space" } },
];

/** This channel's cards, in card order. */
export function typesFor(channel: PageChannel): BusinessType[] {
  return BUSINESS_TYPES.filter((t) => t.channel === channel);
}

export function templateOf(t: BusinessType): Template {
  const template = TEMPLATES.find((x) => x.id === t.templateId);
  if (!template) throw new Error(`business type ${t.id} names a template that does not exist: ${t.templateId}`);
  return template;
}

function withCopy(section: Section, copy: BusinessType["copy"]): Section {
  if (section.type === "booking") return { ...section, title: copy.bookingTitle };
  if (section.type === "hero" && copy.cta !== undefined) return { ...section, cta: copy.cta };
  return section;
}

/** applyTemplate (sample copy stripped, fresh ids, fitted to the mode) with
    the type's own words on the widget and the cover. */
export function applyType(t: BusinessType, mode: OrgMode): PageDocument {
  const doc = applyTemplate(templateOf(t), mode);
  return { ...doc, sections: doc.sections.map((s) => withCopy(s, t.copy)) };
}

/** The card's thumbnail: the template's sample copy with the type's own
    widget title and cover button, so two types on one template still
    read as themselves. */
export function typePreview(t: BusinessType, mode: OrgMode): PageDocument {
  const doc = templatePreview(templateOf(t), mode);
  return { ...doc, sections: doc.sections.map((s) => withCopy(s, t.copy)) };
}
