import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    // Token-in-URL surfaces: never leak via Referer, never index.
    const tokenSurface = [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
    ];
    return [
      { source: "/p/:path*", headers: tokenSurface },
      { source: "/portal/:path*", headers: tokenSurface },
    ];
  },
};

export default nextConfig;
