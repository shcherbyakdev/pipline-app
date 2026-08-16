import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Photo uploads relay through a server action; 15MB cap + multipart
    // overhead (the docs' 10–20KB rule of thumb) needs headroom over the
    // 1MB default.
    serverActions: { bodySizeLimit: "16mb" },
  },
  async headers() {
    // Token-in-URL surfaces: never leak via Referer, never index.
    const tokenSurface = [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
    ];
    return [
      { source: "/p/:path*", headers: tokenSurface },
      { source: "/portal/:path*", headers: tokenSurface },
      // Embeds are meant to be framed (widget iframe); just keep them out
      // of search indexes. No frame-blocking header — embedding is the point.
      { source: "/embed/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex" }] },
    ];
  },
};

export default nextConfig;
