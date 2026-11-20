import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // Dev only: hides the floating route/Turbopack badge (it renders unstyled under our strict CSP). Compile and runtime errors still show.
  devIndicators: false,
  // Dev only: lets a phone/another PC on the LAN open the dev server by IP (otherwise Next blocks its scripts/CSS and the page is blank).
  allowedDevOrigins: ["10.46.210.202"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          // Invitation / reset tokens travel in URLs: never leak them through the Referer header.
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          // The Content-Security-Policy (with a per-request nonce) is set in src/proxy.ts.
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

// `next build` empties .next, which wrecked a dev server running from the same folder (stale modules: "x is not a function"). Dev gets its own folder.
const withDistDir = (phase: string): NextConfig => ({ ...nextConfig, distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next" });
export default withDistDir;
