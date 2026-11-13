"use client";

import { useState } from "react";
import { applyTheme, type ThemeChoice } from "@/lib/theme";

const OPTIONS: { value: ThemeChoice; label: string; icon: string }[] = [
  { value: "light", label: "Light", icon: "M12 4V2m0 20v-2m8-8h2M2 12h2m13.7-5.7 1.4-1.4M4.9 19.1l1.4-1.4m0-11.4L4.9 4.9m14.2 14.2-1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" },
  { value: "system", label: "System", icon: "M4 5h16v11H4zM9 20h6M12 16v4" },
  { value: "dark", label: "Dark", icon: "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" },
];

/**
 * Light / System / Dark switch. The choice is kept in a cookie so the server can render the right theme on the first paint
 * (no inline script, no flash). "System" removes the cookie and follows the device setting.
 * `tone="nav"` is for the dark sidebar; `tone="page"` for light surfaces.
 */
export function ThemeToggle({ initial, tone = "page" }: { initial: ThemeChoice; tone?: "nav" | "page" }) {
  const [choice, setChoice] = useState<ThemeChoice>(initial);

  function pick(next: ThemeChoice) {
    setChoice(next);
    applyTheme(next);
  }

  const wrap = tone === "nav" ? "bg-white/10" : "border border-border bg-surface";
  const on = tone === "nav" ? "bg-white/20 text-white" : "bg-tint text-primary";
  const off = tone === "nav" ? "hover:bg-white/10 hover:text-white" : "text-muted hover:text-foreground";

  return (
    <div role="group" aria-label="Theme" className={`inline-flex gap-0.5 rounded-xl p-0.5 ${wrap}`}>
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={choice === o.value}
          aria-label={`${o.label} theme`}
          title={`${o.label} theme`}
          onClick={() => pick(o.value)}
          className={`flex h-8 w-8 items-center justify-center rounded-[10px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary ${choice === o.value ? on : off}`}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={o.icon} /></svg>
        </button>
      ))}
    </div>
  );
}
