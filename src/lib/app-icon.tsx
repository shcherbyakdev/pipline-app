import { ImageResponse } from "next/og";

/* The installed-app icon (spec 2026-09-05 §3.9, mark added 2026-09-09):
   the Booklo mark (features/marketing/components/booklo-mark.tsx, the same
   path and periwinkle gradient) on a white square, sized like a platform
   app icon. Drawn at request time by next/og so no binary lives in the
   repo; the favicon.ico is untouched. Shared by app/apple-icon.tsx (180)
   and app/manifest-icon (192/512). */
const MARK =
  "M159.603 4.119c20.424 5.543 26.833 22.173 25.137 37.14-1.681 14.832-17.516 28.046-40.735 27.19 6.323.493 26.219 7.822 30.262 25.472 4.19 18.293-5.181 29.59-16.758 35.477-18.166 9.237-38.227 9.211-55.509 8.102 10.621 5.911 25.831 16.991 27.753 34.027 1.923 17.037-12.568 33.26-41.894 27.163-29.326-6.098-84.992-31.19-70.174-74.281 5.942-17.279 25.406-23.795 36.658-26.054 4.87-.977 19.376-3.326 39.8-3.326-24.487-2.356-62.526-14.412-64.413-41.575C25.956-.87 123.06-5.8 159.603 4.12z";

export function appIcon(size: number): ImageResponse {
  const mark = Math.round(size * 0.68);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#ffffff",
        }}
      >
        <svg width={mark} height={mark} viewBox="0 0 200 200">
          <defs>
            <linearGradient id="g" x1="38" y1="14.5" x2="119" y2="181.5" gradientUnits="userSpaceOnUse">
              <stop stopColor="#b9b0ff" />
              <stop offset="1" stopColor="#6975e2" />
            </linearGradient>
          </defs>
          <path fill="url(#g)" d={MARK} />
        </svg>
      </div>
    ),
    { width: size, height: size },
  );
}
