import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";
import { Archivo, Geist_Mono } from "next/font/google";
import "./globals.css";
import { PwaProvider } from "@/components/pwa/pwa-provider";

// One variable font for everything: body text at normal width, the public site's display capitals stretched to 125%.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CampusConnect",
  description: "College placement management platform for engineering colleges.",
  applicationName: "CampusConnect",
  icons: { icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }, { url: "/icons/icon.svg", type: "image/svg+xml" }], apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }] },
  appleWebApp: { capable: true, title: "CampusConnect", statusBarStyle: "black-translucent" },
};

// Zoom stays enabled (no maximumScale). viewportFit "cover" lets the layout use the safe-area insets on notched phones.
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#101210" };

// Every page is rendered per request so the CSP nonce can be applied to its scripts and styles.
export default async function RootLayout({ children }: LayoutProps<"/">) {
  await connection();
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html
      lang="en"
      data-theme={theme === "system" ? undefined : theme}
      className={`${archivo.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col"><PwaProvider>{children}</PwaProvider></body>
    </html>
  );
}
