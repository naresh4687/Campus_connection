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
const EMPTY: StudentFormValues = { departmentId: "", registerNumber: "", fullName: "", collegeEmail: "", personalEmail: "", phone: "", degree: "", specialization: "", admissionYear: "", passingYear: "" };

/** Create (no id) or edit (with id) a student record. College email is frozen once the student has an account. */
export function StudentForm({ id, initial, departments, emailLocked }: { id?: string; initial?: StudentFormValues; departments: { id: string; code: string; name: string; status: string }[]; emailLocked?: boolean }) {
  const [state, action, pending] = useActionState(id ? updateStudentAction : createStudentAction, undefined);
  const v = { ...(initial ?? EMPTY), ...(state?.values ?? {}) } as StudentFormValues;
  const e = state?.fieldErrors ?? {};
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
        <Field id="admissionYear" label="Admission year" type="number" inputMode="numeric" required defaultValue={v.admissionYear} error={e.admissionYear} />
        <Field id="passingYear" label="Passing year" type="number" inputMode="numeric" required defaultValue={v.passingYear} error={e.passingYear} />
      </div>
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : id ? "Save changes" : "Add student"}</Button>
    </form>
  );
}
