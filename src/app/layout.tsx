import type { Metadata } from "next";
import { Geist_Mono, Inter, Outfit } from "next/font/google";
import { SITE } from "@/features/marketing/site";
import "./globals.css";

// One type voice for the whole product (landing, auth, admin, booking
// pages): Inter for everything that is read, Geist Mono where a value is a
// value, Outfit Semibold only for the wordmark. The (marketing) layout
// re-declares the same variables; both resolve to the same faces.
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin", "cyrillic"],
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

const outfit = Outfit({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["600"],
});

export const metadata: Metadata = {
  title: "Booklo",
  description: SITE.description,
  // Google only pushes calendar notifications to a verified domain (spec
  // 2026-09-05 v2 decision 20): Search Console's meta-tag verification.
  ...(process.env.GOOGLE_SITE_VERIFICATION ? { verification: { google: process.env.GOOGLE_SITE_VERIFICATION } } : {}),
};

const DIRECTION_CONTRACT = `<!--
IMPECCABLE DIRECTION CONTRACT (marketing landing /)
THESIS: Your booking page, sold the way gumloop.com and family.co sell theirs: a white page washing into lavender (aave.com-referenced), headlines at weight 500, black pill buttons, product shown as built fragments on soft grey panels, colour only where it names a kind of booking. One dark plum band (the final claim section, nav inverts over it); the hero is the booking page itself at real size, playing a client booking a slot, with a switch between appointments and spaces. Refuses floating elements, pointers in the hero, gradients and shapes behind the product, highlighter marks, boxed sections, three equal cards and section-numbered eyebrows.
OWN-WORLD: ground #fefefe, plum ink #252228, lavender panels #f4f2fb (hover #eeecf8), secondary text #5c5964, captions #686472, hairlines rgb(37 34 40 / 7%), one layered shadow; ink pills as the only controls, the appointments indigo #6975e2 (Linear's accent, lch 52.4 61.1 288.4) doubling as the brand accent (text-safe #4b5bc4) (focus rings, checked controls, active nav icon); kind colours (appointments indigo #6975e2, spaces green #01d062, classes pink #ff3d8f, stays orange #ff9500, embed purple #8b5cf6) with soft tints for dots, discs, bars and three tinted bento cells, and text-safe tones (#4f42d8, #0c7039, #b61a60, #a04a06) whenever a kind colour is set as text (>= 5:1 on their soft tints), ink #1c1c1a for text ON a solid kind colour, never in the chrome and never as labels above headings; Outfit 500 for landing display headlines, Inter 400/500 for everything read, Outfit Semibold for the wordmark, Geist Mono for values; shape rule: pills for controls, 22-28px panels, 10-14px fragments; motion by Emil Kowalski rules (strong ease-out, transform/opacity/clip-path/filter, transitions for state-driven UI, 60ms stagger, hover gated to fine pointers, every loop with a reduced-motion end state).
STORY: A provider watches a client pick a service, a day and a time on their page, sees the confirmation and the reminder land, flips the page to spaces and sees it hold a room and a cabin just as well, and claims the name.
FIRST VIEWPORT: 72px nav with the Outfit wordmark, plain links, lavender-ghost Log in and ink Get started pills; centred mini hero: a row of four die-cut sticker glyphs, one per kind (blue clock, pink people, green check disc-badge, orange moon; fat white contour + soft drop shadow), entering on a 70ms stagger then taking a quiet sequential story beat on the shared 8s cycle, a two-line Outfit headline at 54px/500, 20-word sub, the claim bar (pill, ink submit) as the primary action, three green-check truths; then a lavender-wash stage (white fading to periwinkle, the reference's hero fade) holding the booking-page card (no tabs: the card flips between appointments and spaces on its own, two client scenarios per channel) at 900px (provider header, services or spaces, the month with the channel colour on open days, the times) playing its loop: a slot considered, then Booked, the confirmation and the scheduled reminder reported in the card footer, the next client on another day. Nothing floats; the card scales down on phones.
FORM: Product-first soft, fourth cut (seed 7d4ba3e9; the roll assigned 3): after two teak.io cuts and a Linear-like cut were set aside on 2026-08-28, the user named gumloop.com and family.co as references; on 2026-08-29 the user asked for the booking-page card from main to be kept and modernised, so the hero is that card ported into this world; the concept was audited against the taste skill and Emil Kowalski rules.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
-->`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: next-themes sets the `dark`/`light` class on
    // <html> before hydration (dashboard only), which otherwise mismatches
    // server output. The root itself is light — the soft world's tokens live
    // on :root — so public pages need no theme class at all.
    <html
      lang="en"
      className={`${inter.variable} ${geistMono.variable} ${outfit.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      {/* suppressHydrationWarning: browser extensions (e.g. Bitdefender)
          inject attributes onto <body> before React hydrates. This ignores
          attribute mismatches on <body> only — one level deep, so real
          hydration bugs in the app are still reported. */}
      <body suppressHydrationWarning className="min-h-full flex flex-col">
        {/* Direction contract for the marketing landing (impeccable new-work
            §5). Emitted as a real HTML comment so it survives the production
            build and can be audited there; React cannot render comment nodes
            directly, hence the hidden host element. */}
        <div hidden aria-hidden="true" dangerouslySetInnerHTML={{ __html: DIRECTION_CONTRACT }} />
        {children}
      </body>
    </html>
  );
}
