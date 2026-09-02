import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  experimental: {
    // Photo uploads relay through a server action; 15MB cap + multipart
    // overhead (the docs' 10–20KB rule of thumb) needs headroom over the
    // 1MB default.
    serverActions: { bodySizeLimit: "16mb" },
  },
  async headers() {
    // Token-in-URL surfaces: never leak via Referer, never index. (No
    // Cache-Control here: Next owns that header for pages and overwrites
    // it; dynamic pages already answer private/no-store.)
    const tokenSurface = [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
    ];
    // Baseline hardening for everything that is NOT the embed (audit
    // 2026-08-24): the dashboard and token pages must not be framed;
    // nosniff and a restrictive Permissions-Policy cost nothing. HSTS comes
    // from Vercel. No CSP yet — Next's inline runtime would need nonces.
    const hardened = [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
    ];
    return [
      // Everything except /embed/* (regex negative lookahead in the source).
      { source: "/((?!embed/).*)", headers: hardened },
      { source: "/p/:path*", headers: tokenSurface },
      { source: "/portal/:path*", headers: tokenSurface },
      { source: "/booking/:path*", headers: tokenSurface },
      // Embeds are meant to be framed (widget iframe); just keep them out
      // of search indexes. No frame-blocking header — embedding is the point.
      {
        source: "/embed/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");
export default withNextIntl(nextConfig);
