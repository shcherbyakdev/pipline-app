import type { Metadata } from "next";
import type { PageDocument } from "./schema";
import { pageImageUrl } from "./images";
import { bookingDescription } from "@/features/orgs/vocab";
import { pageChannelMode, type PageChannel } from "./channel";

/** Spec precedence: hero headline → header tagline → first line of about → fallback. Hidden sections never leak. */
export function pageDescription(doc: PageDocument, fallback: string): string {
  const visible = doc.sections.filter((s) => !s.hidden);
  const hero = visible.find((s) => s.type === "hero");
  if (hero?.type === "hero" && hero.headline.trim()) return hero.headline.trim();
  const header = visible.find((s) => s.type === "header");
  if (header?.type === "header" && header.tagline.trim()) return header.tagline.trim();
  const about = visible.find((s) => s.type === "about");
  if (about?.type === "about" && about.body.trim()) return about.body.trim().split("\n")[0]?.trim() || fallback;
  return fallback;
}

export function heroImagePath(doc: PageDocument): string | null {
  const hero = doc.sections.find((s) => s.type === "hero" && !s.hidden && s.imagePath);
  return hero?.type === "hero" ? hero.imagePath ?? null : null;
}

export function pageMetadata(
  doc: PageDocument,
  org: { orgName: string },
  supabaseUrl: string,
  channel: PageChannel,
): Metadata {
  const image = heroImagePath(doc);
  // The page's own channel (spec 2026-08-28 §3.6): a spaces page says
  // "Book a space at X" whatever else the org sells.
  return {
    title: org.orgName,
    description: pageDescription(doc, bookingDescription(pageChannelMode(channel), org.orgName)),
    ...(image ? { openGraph: { images: [pageImageUrl(supabaseUrl, image)] } } : {}),
  };
}
