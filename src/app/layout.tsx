import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";
import { Geist, Geist_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const display = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CampusConnect",
  description: "College placement management platform for engineering colleges.",
};

// Zoom stays enabled (no maximumScale). viewportFit "cover" lets the layout use the safe-area insets on notched phones.
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

// Every page is rendered per request so the CSP nonce can be applied to its scripts and styles.
export default async function RootLayout({ children }: LayoutProps<"/">) {
  await connection();
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html
      lang="en"
      data-theme={theme === "system" ? undefined : theme}
      className={`${geistSans.variable} ${geistMono.variable} ${display.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
