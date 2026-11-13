"use client";

import { useActionState } from "react";
import { INDUSTRY_SUGGESTIONS } from "@/lib/companies";
import { createCompanyAction, updateCompanyAction } from "@/server/companies/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

export type CompanyValues = { name: string; website: string; industry: string; description: string; contactPerson: string; contactEmail: string; contactPhone: string; location: string };
const EMPTY: CompanyValues = { name: "", website: "", industry: "", description: "", contactPerson: "", contactEmail: "", contactPhone: "", location: "" };

export function CompanyForm({ id, initial }: { id?: string; initial?: CompanyValues }) {
  const [state, action, pending] = useActionState(id ? updateCompanyAction : createCompanyAction, undefined);
  const v = { ...(initial ?? EMPTY), ...(state?.values ?? {}) } as CompanyValues;
  const e = state?.fieldErrors ?? {};
  return (
    <form action={action} className="max-w-3xl space-y-4" noValidate>
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      {state?.ok ? <Alert kind="success">{state.ok}</Alert> : null}
      {id ? <input type="hidden" name="id" value={id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="name" label="Company name" required maxLength={150} defaultValue={v.name} error={e.name} />
        <Field id="website" label="Website (optional)" type="url" placeholder="https://" defaultValue={v.website} error={e.website} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="industry" label="Industry (optional)" list="industries" maxLength={80} defaultValue={v.industry} error={e.industry} />
        <Field id="location" label="Location (optional)" maxLength={150} defaultValue={v.location} error={e.location} />
      </div>
      <datalist id="industries">{INDUSTRY_SUGGESTIONS.map((i) => <option key={i} value={i} />)}</datalist>
      <Textarea id="description" label="Description (optional)" rows={4} maxLength={2000} defaultValue={v.description} error={e.description} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="contactPerson" label="Contact person (optional)" maxLength={120} defaultValue={v.contactPerson} error={e.contactPerson} />
        <Field id="contactEmail" label="Contact email (optional)" type="email" defaultValue={v.contactEmail} error={e.contactEmail} />
        <Field id="contactPhone" label="Contact phone (optional)" type="tel" defaultValue={v.contactPhone} error={e.contactPhone} />
      </div>
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : id ? "Save changes" : "Add company"}</Button>
    </form>
  );
}
