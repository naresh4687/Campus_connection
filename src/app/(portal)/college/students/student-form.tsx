"use client";

import { useActionState } from "react";
import { DEGREES } from "@/lib/students";
import { createStudentAction, updateStudentAction } from "@/server/students/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { upperInput } from "@/lib/normalize";

export type StudentFormValues = {
  departmentId: string; registerNumber: string; fullName: string; collegeEmail: string; personalEmail: string; phone: string;
  degree: string; specialization: string; admissionYear: string; passingYear: string;
};
/** Year choices that move with the calendar (this year +/- a window); a value already saved outside the window is still offered so editing never loses it. */
const years = (from: number, to: number, keep: string) => { const l = Array.from({ length: to - from + 1 }, (_, i) => from + i); const k = Number(keep); return Number.isInteger(k) && k > 0 && !l.includes(k) ? [...l, k].sort((a, b) => a - b) : l; };
const EMPTY: StudentFormValues = { departmentId: "", registerNumber: "", fullName: "", collegeEmail: "", personalEmail: "", phone: "", degree: "", specialization: "", admissionYear: "", passingYear: "" };

/** Create (no id) or edit (with id) a student record. College email is frozen once the student has an account. */
export function StudentForm({ id, initial, departments, emailLocked }: { id?: string; initial?: StudentFormValues; departments: { id: string; code: string; name: string; status: string }[]; emailLocked?: boolean }) {
  const [state, action, pending] = useActionState(id ? updateStudentAction : createStudentAction, undefined);
  const v = { ...(initial ?? EMPTY), ...(state?.values ?? {}) } as StudentFormValues;
  const e = state?.fieldErrors ?? {};
  const thisYear = new Date().getFullYear();
  return (
    <form action={action} className="max-w-3xl space-y-4" noValidate>
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      {state?.ok ? <Alert kind="success">{state.ok}</Alert> : null}
      {id ? <input type="hidden" name="id" value={id} /> : null}
      <div className="grid gap-4 @xl:grid-cols-2">
        <Field id="registerNumber" label="Register number" required maxLength={30} autoCapitalize="characters" autoCorrect="off" spellCheck={false} onInput={upperInput} defaultValue={v.registerNumber} error={e.registerNumber} />
        <Field id="fullName" label="Full name" required maxLength={120} defaultValue={v.fullName} error={e.fullName} />
      </div>
      <div className="grid gap-4 @xl:grid-cols-2">
        <Field id="collegeEmail" label="College email" type="email" required readOnly={emailLocked} defaultValue={v.collegeEmail} error={e.collegeEmail}
          hint={emailLocked ? "Locked: this student already has an account." : "The student signs in with this address."} />
        <Field id="personalEmail" label="Personal email (optional)" type="email" defaultValue={v.personalEmail} error={e.personalEmail} />
      </div>
      <div className="grid gap-4 @xl:grid-cols-2">
        <Select key={`dept-${v.departmentId}`} id="departmentId" label="Department" required defaultValue={v.departmentId} error={e.departmentId}>
          <option value="" disabled>Choose…</option>
          {departments.map((d) => <option key={d.id} value={d.id} disabled={d.status !== "ACTIVE" && d.id !== initial?.departmentId}>{d.code} — {d.name}{d.status !== "ACTIVE" ? " (inactive)" : ""}</option>)}
        </Select>
        <Field id="phone" label="Phone (optional)" type="tel" defaultValue={v.phone} error={e.phone} />
      </div>
      <div className="grid gap-4 @xl:grid-cols-2">
        <Select key={`deg-${v.degree}`} id="degree" label="Degree / course" required defaultValue={v.degree} error={e.degree}>
          <option value="" disabled>Choose…</option>
          {DEGREES.map((d) => <option key={d} value={d}>{d}</option>)}
        </Select>
        <Field id="specialization" label="Specialization (optional)" maxLength={100} defaultValue={v.specialization} error={e.specialization} />
      </div>
      <div className="grid gap-4 @xl:grid-cols-2">
        <Select key={`adm-${v.admissionYear}`} id="admissionYear" label="Admission year" required defaultValue={v.admissionYear} error={e.admissionYear}>
          <option value="" disabled>Choose…</option>{years(thisYear - 10, thisYear, v.admissionYear).map((y) => <option key={y} value={y}>{y}</option>)}
        </Select>
        <Select key={`pass-${v.passingYear}`} id="passingYear" label="Passing year" required defaultValue={v.passingYear} error={e.passingYear}>
          <option value="" disabled>Choose…</option>{years(thisYear - 6, thisYear + 8, v.passingYear).map((y) => <option key={y} value={y}>{y}</option>)}
        </Select>
      </div>
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : id ? "Save changes" : "Add student"}</Button>
    </form>
  );
}
