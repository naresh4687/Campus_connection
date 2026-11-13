export const THEME_COOKIE = "cc-theme";
export type ThemeChoice = "light" | "system" | "dark";

/** Anything other than an explicit light or dark choice means "follow the device". */
export const parseTheme = (v: string | undefined): ThemeChoice => (v === "light" || v === "dark" ? v : "system");

/** Browser only. Applies the choice to <html> right away and remembers it in a cookie so the server renders it next time. */
export function applyTheme(next: ThemeChoice): void {
  const root = document.documentElement;
  if (next === "system") {
    root.removeAttribute("data-theme");
    document.cookie = `${THEME_COOKIE}=; path=/; max-age=0; samesite=lax`;
  } else {
    root.setAttribute("data-theme", next);
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  }
}
