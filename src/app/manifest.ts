import type { MetadataRoute } from "next";

/** Web App Manifest, served at /manifest.webmanifest. Colours are the design tokens in globals.css (brand lime on ink). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "CampusConnect",
    short_name: "CampusConnect",
    description: "College placement management: drives, eligibility, rounds, offers and updates for students, coordinators and placement officers.",
    // /app sends a signed-in user to their own home and everyone else to the sign-in page (see src/app/app/route.ts).
    start_url: "/app?source=pwa",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "any",
    theme_color: "#101210",
    background_color: "#eef5e8",
    lang: "en-IN",
    categories: ["education", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
