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
  subsets: ["latin"],
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
};

const DIRECTION_CONTRACT = `<!--
IMPECCABLE DIRECTION CONTRACT (marketing landing /)
THESIS: Your booking page, sold the way gumloop.com and family.co sell theirs: a warm off-white page, headlines at weight 500, black pill buttons, product shown as built fragments on soft grey panels, colour only where it names a kind of booking. The hero is the booking page itself at real size, playing a client booking a slot, with a switch between appointments and spaces. Refuses floating elements, pointers in the hero, gradients and shapes behind the product, highlighter marks, boxed sections, three equal cards and section-numbered eyebrows.
OWN-WORLD: ground #fbfbfa, near-black #1c1c1a, soft grey panels #f4f4f2 (hover #efefec), secondary text #5f5f5b, captions #737370, hairlines rgb(28 28 26 / 7%), one layered shadow; ink pills as the only controls; kind colours (appointments blue #1e8bff, spaces green #22b455, classes pink #ff3d8f, stays orange #ff9500, embed purple #8b5cf6) with soft tints for dots, discs, bars and three tinted bento cells, and text-safe tones (#0b6fd6, #15803d, #c81e6a, #b45309) whenever a kind colour is set as text, never in the chrome and never as labels above headings; Inter (500 display, 400 body) + Outfit Semibold for the wordmark only + Geist Mono for values; shape rule: pills for controls, 22-28px panels, 10-14px fragments; motion by Emil Kowalski rules (strong ease-out, transform/opacity/clip-path/filter, transitions for state-driven UI, 60ms stagger, hover gated to fine pointers, every loop with a reduced-motion end state).
STORY: A provider watches a client pick a service, a day and a time on their page, sees the confirmation and the reminder land, flips the page to spaces and sees it hold a room and a cabin just as well, and claims the name.
FIRST VIEWPORT: 72px nav with the Outfit wordmark, plain links, grey Log in and ink Get started pills; centred hero: two-line headline at 60px/500, 20-word sub, the claim bar (pill, ink submit) as the primary action, three green-check truths; then an Appointments / Spaces switch on the top edge of a soft grey stage holding the booking-page card at 900px (provider header, services or spaces, the month with the channel colour on open days, the times) playing its loop: a slot considered, then Booked, the confirmation and the scheduled reminder reported in the card footer, the next client on another day. Nothing floats; the card scales down on phones.
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
