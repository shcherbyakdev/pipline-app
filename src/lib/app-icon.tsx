import { ImageResponse } from "next/og";

/* The installed-app icon (spec 2026-09-05 §3.9): the brand periwinkle
   square with a white lowercase "b" — the wordmark's first letter, no
   symbol (the 2026-08-28 wordmark ruling). Drawn at request time by
   next/og so no binary lives in the repo; the favicon.ico is untouched.
   Shared by app/apple-icon.tsx (180) and app/manifest-icon (192/512). */
export function appIcon(size: number): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#978eff",
          color: "#ffffff",
          fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
          fontWeight: 700,
          fontSize: Math.round(size * 0.66),
          letterSpacing: "-0.04em",
          // Optical centre: a lowercase b sits low; nudge it up a touch.
          paddingBottom: Math.round(size * 0.06),
        }}
      >
        b
      </div>
    ),
    { width: size, height: size },
  );
}
