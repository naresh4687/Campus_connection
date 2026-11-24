import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

// Dev only: the addresses this computer has on the local network (they change with every Wi-Fi), plus any extras in DEV_ALLOWED_ORIGINS
// (comma separated hostnames, e.g. a tunnel). Without them a phone opening http://<this-ip>:3000 gets no scripts, so forms fall back to plain
// posts and sign-in fails with "Invalid Server Actions request".
const lanHosts = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i!.address);
const extraHosts = (process.env.DEV_ALLOWED_ORIGINS ?? "").split(",").map((h) => h.trim()).filter(Boolean);

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // Dev only: hides the floating route/Turbopack badge (it renders unstyled under our strict CSP). Compile and runtime errors still show.
  devIndicators: false,
  // Dev only: lets a phone/another PC on the LAN open the dev server by IP (otherwise Next blocks its scripts/CSS and the page is blank).
  allowedDevOrigins: [...lanHosts, ...extraHosts],
  async headers() {
    return [
      // The service worker file must always be re-checked so updates are found; it may control the whole site.
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }, { key: "Service-Worker-Allowed", value: "/" }, { key: "Content-Type", value: "text/javascript; charset=utf-8" }] },
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
