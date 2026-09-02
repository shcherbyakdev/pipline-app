import { DM_Sans, Geist, IBM_Plex_Mono, Inter, Lora, Space_Grotesk } from "next/font/google";
import type { WidgetThemeConfig } from "@/lib/widget-theme";

// Separate `next/font/google` instances for the PUBLIC booking widget only.
// The root layout already loads Inter/JetBrains Mono for the app shell —
// these must only be imported from widget surfaces (booking widget, embed
// wrapper), never from app pages, to keep the two font sets independent.
// preload: false on every instance — a given embed only ever applies ONE of
// these families (widgetFontClass below returns a single class), so
// preloading all six would ship unused font preload links to every embed.
// Geist: the Main template's face (gumloop.com sets its UI and body in it).
const widgetGeist = Geist({ subsets: ["latin"], variable: "--widget-font-geist", preload: false });
const widgetInter = Inter({ subsets: ["latin"], variable: "--widget-font-inter", preload: false });
const widgetDmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--widget-font-dm-sans",
  preload: false,
});
const widgetLora = Lora({ subsets: ["latin"], variable: "--widget-font-lora", preload: false });
const widgetSpaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--widget-font-space-grotesk",
  preload: false,
});
const widgetIbmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--widget-font-ibm-plex-mono",
  preload: false,
});

export function widgetFontClass(font: WidgetThemeConfig["font"]): string {
  switch (font) {
    case "geist":
      return widgetGeist.className;
    case "inter":
      return widgetInter.className;
    case "dm-sans":
      return widgetDmSans.className;
    case "lora":
      return widgetLora.className;
    case "space-grotesk":
      return widgetSpaceGrotesk.className;
    case "ibm-plex-mono":
      return widgetIbmPlexMono.className;
    case "system":
    default:
      return "";
  }
}
