"use client";

import { useActionState, useState } from "react";
import { DEGREES } from "@/lib/students";
import { submitJoinAction } from "@/server/join/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { upperInput } from "@/lib/normalize";

export function JoinForm({ token, departments }: { token: string; departments: { id: string; code: string; name: string; degree: string | null }[] }) {
  const [state, action, pending] = useActionState(submitJoinAction, undefined);
  const v = state?.values ?? {}; const e = state?.fieldErrors ?? {};
  // Choosing a department fills in its degree (the student can still change it).
  const [auto, setAuto] = useState<string>("");   // uncontrolled select, re-created only when a department with a degree is chosen (a controlled one is blanked by the form reset after a failed submit)
  const now = new Date().getFullYear();
  const joined = Array.from({ length: 9 }, (_, i) => now - i); const finish = Array.from({ length: 10 }, (_, i) => now - 1 + i);
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="token" value={token} />
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      <Field id="fullName" label="Full name" autoComplete="name" required maxLength={120} defaultValue={v.fullName} error={e.fullName} />
      <Field id="registerNumber" label="Register number" required maxLength={30} autoCapitalize="characters" autoCorrect="off" spellCheck={false} onInput={upperInput} defaultValue={v.registerNumber} error={e.registerNumber} />
      <Select key={`dept-${v.departmentId}`} id="departmentId" label="Department" required defaultValue={v.departmentId ?? ""} error={e.departmentId}
        onChange={(ev) => { const d = departments.find((x) => x.id === ev.target.value); if (d?.degree) setAuto(d.degree); }}>
        <option value="">Choose your department…</option>
        {departments.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.code})</option>)}
      </Select>
      <Field id="collegeEmail" label="College email" type="email" autoComplete="email" required defaultValue={v.collegeEmail} error={e.collegeEmail} hint="You will sign in with this email." />
      <Field id="phone" label="Mobile number" type="tel" autoComplete="tel" required maxLength={20} defaultValue={v.phone} error={e.phone} hint="Your coordinator may call or message you on this number." />
      <Field id="personalEmail" label="Personal email (optional)" type="email" maxLength={254} defaultValue={v.personalEmail} error={e.personalEmail} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Select key={`deg-${v.degree}-${auto}`} id="degree" label="Degree" required defaultValue={auto || (v.degree ?? "")} error={e.degree}><option value="">Choose…</option>{DEGREES.map((d) => <option key={d} value={d}>{d}</option>)}</Select>
        <Select key={`adm-${v.admissionYear}`} id="admissionYear" label="Year you joined" required defaultValue={v.admissionYear ?? ""} error={e.admissionYear}><option value="">Choose…</option>{joined.map((y) => <option key={y} value={y}>{y}</option>)}</Select>
        <Select key={`pass-${v.passingYear}`} id="passingYear" label="Year you finish" required defaultValue={v.passingYear ?? ""} error={e.passingYear}><option value="">Choose…</option>{finish.map((y) => <option key={y} value={y}>{y}</option>)}</Select>
      </div>
      <Field id="password" label="Choose a password" type="password" autoComplete="new-password" required minLength={10} maxLength={128} error={e.password} hint="At least 10 characters." />
      <Field id="confirm" label="Confirm password" type="password" autoComplete="new-password" required error={e.confirm} />
      <Button type="submit" disabled={pending} className="w-full">{pending ? "Sending…" : "Request my account"}</Button>
    </form>
  );
}
