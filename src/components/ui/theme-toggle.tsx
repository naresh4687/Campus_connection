"use client";

import { useSyncExternalStore } from "react";
import { applyTheme, type ThemeChoice } from "@/lib/theme";

const SUN = "M12 4V2m0 20v-2m8-8h2M2 12h2m13.7-5.7 1.4-1.4M4.9 19.1l1.4-1.4m0-11.4L4.9 4.9m14.2 14.2-1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z";
const MOON = "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z";

/** Is the page showing the dark theme right now (an explicit choice, or the device setting when there is none)? */
function showingDark(): boolean {
  const t = document.documentElement.getAttribute("data-theme");
  return t === "dark" || (t !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
}

/** Re-render when the theme attribute or the device setting changes. */
function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  media.addEventListener("change", onChange);
  return () => { observer.disconnect(); media.removeEventListener("change", onChange); };
}

/**
 * One button that switches between light and dark. Until the user picks, the page follows the device setting.
 * The icon is chosen by CSS (the `dark:` variant in globals.css), so it is right on the first paint even when
 * the server cannot know the device setting. The choice is kept in a cookie so the server renders it next time.
 * `tone="nav"` is for dark surfaces (the sidebar, the footer), `tone="brand"` for lime panels, `tone="page"` for the page background.
 */
export function ThemeToggle({ initial, tone = "page" }: { initial: ThemeChoice; tone?: "nav" | "page" | "brand" }) {
  // The server knows the state only for an explicit choice; with "follow the device" it is filled in after hydration.
  const dark = useSyncExternalStore<boolean | null>(subscribe, showingDark, () => (initial === "system" ? null : initial === "dark"));

  function toggle() {
    applyTheme(showingDark() ? "light" : "dark");
  }

  const look = {
    nav: "border-white/15 text-nav-foreground hover:bg-white/10 hover:text-white",
    brand: "border-brand-foreground/25 text-brand-foreground hover:bg-brand-foreground/10 focus-visible:outline-brand-foreground",
    page: "border-border bg-surface text-foreground hover:border-foreground/30 hover:bg-tint",
  }[tone];

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Dark theme"
      aria-pressed={dark ?? undefined}
      title="Switch between light and dark"
      className={`inline-flex h-10 w-10 items-center justify-center rounded-full border transition-[background-color,border-color,transform] duration-150 active:scale-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${look}`}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="block h-[18px] w-[18px] dark:hidden" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={MOON} /></svg>
      <svg aria-hidden="true" viewBox="0 0 24 24" className="hidden h-[18px] w-[18px] dark:block" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={SUN} /></svg>
    </button>
  );
}
