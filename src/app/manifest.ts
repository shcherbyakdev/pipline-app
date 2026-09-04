import type { MetadataRoute } from "next";

/* Installable app (spec 2026-09-05 §3.9). Standalone display and a
   /bookings start so the Home Screen icon opens the admin like an app —
   and, on iOS, so Web Push is allowed at all (16.4+, installed only).
   Colours: the light ground and the brand periwinkle from globals.css. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Booklo",
    short_name: "Booklo",
    description: "Bookings, spaces and reminders for your business.",
    start_url: "/bookings",
    scope: "/",
    display: "standalone",
    background_color: "#fefefe",
    theme_color: "#978eff",
    icons: [
      { src: "/api/manifest-icon?size=192", sizes: "192x192", type: "image/png" },
      { src: "/api/manifest-icon?size=512", sizes: "512x512", type: "image/png" },
    ],
  };
}
