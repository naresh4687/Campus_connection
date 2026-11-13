"use client";

import { useState } from "react";
import { Button } from "./button";

export function CopyButton({ value, label = "Copy link" }: { value: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <Button
      type="button"
      variant="secondary"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setState("copied");
        } catch {
          setState("failed");
        }
      }}
    >
      {state === "copied" ? "Copied" : state === "failed" ? "Copy failed — select the link and copy it" : label}
    </Button>
  );
}
