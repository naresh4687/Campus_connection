"use client";

import { useActionState } from "react";
import { setPreferenceAction } from "@/server/notifications/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function PrefToggle({ category, label, help, enabled, essential }: { category: string; label: string; help: string; enabled: boolean; essential: boolean }) {
  const [state, run, pending] = useActionState(setPreferenceAction, undefined);
  const on = state?.ok ? state.ok === "Turned on." : enabled;
  return (
    <li className="space-y-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-sm font-medium">{label}</p><p className="text-xs text-muted">{help}</p></div>
        {essential ? <span className="text-sm text-muted">Always on</span> : (
          <form action={run} className="flex items-center gap-3">
            <input type="hidden" name="category" value={category} /><input type="hidden" name="enabled" value={on ? "no" : "yes"} />
            <span className="text-sm" aria-live="polite">{on ? "On" : "Off"}</span>
            <Button type="submit" variant="secondary" disabled={pending} aria-label={`${on ? "Turn off" : "Turn on"} ${label}`}>{on ? "Turn off" : "Turn on"}</Button>
          </form>
        )}
      </div>
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
    </li>
  );
}
