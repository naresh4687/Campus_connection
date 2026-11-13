"use client";

import { useActionState } from "react";
import { INDIAN_STATES } from "@/lib/india";
import { updateProfileAction } from "@/server/college/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";

type Initial = { address: string; district: string; state: string; website: string; contactPerson: string; phone: string; approxStudents: string };

export function ProfileForm({ initial }: { initial: Initial }) {
  const [state, action, pending] = useActionState(updateProfileAction, undefined);
  const v = { ...initial, ...(state?.values ?? {}) };
  const e = state?.fieldErrors ?? {};
  return (
    <form action={action} className="max-w-2xl space-y-4" noValidate>
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      {state?.ok ? <Alert kind="success">{state.ok}</Alert> : null}
      <Field id="address" label="Address" required maxLength={500} defaultValue={v.address} error={e.address} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Select key={`state-${v.state}`} id="state" label="State / union territory" required defaultValue={v.state} error={e.state}>
          <option value="" disabled>Choose…</option>
          {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
        <Field id="district" label="District" required maxLength={100} defaultValue={v.district} error={e.district} />
      </div>
      <Field id="website" label="Website" type="url" required defaultValue={v.website} error={e.website} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="contactPerson" label="Contact person" required maxLength={120} defaultValue={v.contactPerson} error={e.contactPerson} />
        <Field id="phone" label="Phone" type="tel" required defaultValue={v.phone} error={e.phone} />
      </div>
      <Field id="approxStudents" label="Approximate student strength" type="number" inputMode="numeric" min={10} max={200000} required defaultValue={v.approxStudents} error={e.approxStudents} />
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save profile"}</Button>
    </form>
  );
}
