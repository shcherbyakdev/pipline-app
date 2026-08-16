import { DM_Sans, IBM_Plex_Mono, Inter, Lora, Space_Grotesk } from "next/font/google";
import type { WidgetThemeConfig } from "@/lib/widget-theme";

// Separate `next/font/google` instances for the PUBLIC booking widget only.
// The root layout already loads Inter/JetBrains Mono for the app shell —
// these must only be imported from widget surfaces (booking widget, embed
// wrapper), never from app pages, to keep the two font sets independent.
const widgetInter = Inter({ subsets: ["latin"], variable: "--widget-font-inter" });
const widgetDmSans = DM_Sans({ subsets: ["latin"], variable: "--widget-font-dm-sans" });
const widgetLora = Lora({ subsets: ["latin"], variable: "--widget-font-lora" });
const widgetSpaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--widget-font-space-grotesk",
});
const widgetIbmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--widget-font-ibm-plex-mono",
});

export function widgetFontClass(font: WidgetThemeConfig["font"]): string {
  switch (font) {
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
