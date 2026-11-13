import { cookies } from "next/headers";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";
import { ThemeToggle } from "./theme-toggle";

/** Server wrapper: reads the saved choice so the toggle renders in the right state on first paint. */
export async function ThemeSwitch({ tone }: { tone?: "nav" | "page" }) {
  const initial = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return <ThemeToggle initial={initial} tone={tone} />;
}
