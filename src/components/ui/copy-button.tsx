"use client";

import { useEffect, useRef, useState } from "react";
import { copyText } from "@/lib/clipboard";
import { Button } from "./button";

/**
 * "Copy link" that only says Copied when the browser confirmed it. If the browser refuses (plain-http page, denied
 * permission, old mobile browser), the link is selected so Ctrl/Cmd+C works and a clear message says so.
 * `inputId` names the visible, read-only field holding the same link.
 */
export function CopyButton({ value, label = "Copy link", inputId }: { value: string; label?: string; inputId?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        variant="secondary"
        onClick={async () => {
          const field = inputId ? (document.getElementById(inputId) as HTMLInputElement | null) : null;
          const r = await copyText(value, field);
          if (r === "unavailable") field?.select();   // leave the link selected for a manual copy
          setState(r === "copied" ? "copied" : "manual");
          if (timer.current) clearTimeout(timer.current);
          if (r === "copied") timer.current = setTimeout(() => setState("idle"), 3000);
        }}
      >
        {state === "copied" ? "Copied" : label}
      </Button>
      <span role="status" aria-live="polite" className="text-sm">
        {state === "copied" ? <span className="text-foreground">Link copied to the clipboard.</span> : null}
        {state === "manual" ? <span className="text-danger">Your browser blocked copying (this page may not be secure). The link is selected: press Ctrl+C (or Cmd+C), or touch and hold to copy.</span> : null}
      </span>
    </div>
  );
}
