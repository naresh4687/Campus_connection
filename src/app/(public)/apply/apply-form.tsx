"use client";

import { useActionState } from "react";
import { COLLEGE_TYPES, INDIAN_STATES } from "@/lib/india";
import { submitApplicationAction } from "@/server/platform/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { PrivacyNote } from "@/components/ui/privacy-note";
import { Select } from "@/components/ui/select";

export function ApplyForm() {
  const [state, action, pending] = useActionState(submitApplicationAction, undefined);
  const v = state?.values ?? {};
  const e = state?.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-5" noValidate>
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      <Field id="name" label="College name" autoComplete="organization" required maxLength={200} defaultValue={v.name} error={e.name} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="officialEmail" label="Official email" type="email" required autoComplete="email" defaultValue={v.officialEmail} error={e.officialEmail} hint="An address at the college's own domain." />
        <Field id="website" label="Website" type="url" autoComplete="url" required placeholder="https://" defaultValue={v.website} error={e.website} />
      </div>
      <Field id="address" label="Address" autoComplete="street-address" required maxLength={500} defaultValue={v.address} error={e.address} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Select key={`state-${v.state ?? ""}`} id="state" label="State / union territory" required defaultValue={v.state ?? ""} error={e.state}>
          <option value="" disabled>Choose…</option>
          {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
        <Field id="district" label="District" autoComplete="address-level2" required maxLength={100} defaultValue={v.district} error={e.district} />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="contactPerson" label="Contact person" required maxLength={120} autoComplete="name" defaultValue={v.contactPerson} error={e.contactPerson} />
        <Field id="phone" label="Phone" type="tel" required autoComplete="tel" defaultValue={v.phone} error={e.phone} />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Select key={`type-${v.collegeType ?? ""}`} id="collegeType" label="College type" required defaultValue={v.collegeType ?? ""} error={e.collegeType}>
          <option value="" disabled>Choose…</option>
          {COLLEGE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </Select>
        <Field id="approxStudents" label="Approximate student strength" type="number" inputMode="numeric" min={10} max={200000} required defaultValue={v.approxStudents} error={e.approxStudents} hint="Total students across all years." />
      </div>
      {/* Honeypot: hidden from people, tempting to bots. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>Leave this empty<input type="text" name="contactUrl" tabIndex={-1} autoComplete="off" /></label>
      </div>
      <PrivacyNote />
      <Button type="submit" disabled={pending}>{pending ? "Submitting…" : "Submit application"}</Button>
    </form>
  );
}
