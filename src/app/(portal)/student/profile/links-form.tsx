"use client";

import { useActionState } from "react";
import { updateOwnLinksAction } from "@/server/students/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

export function LinksForm({ github, leetcode, linkedin }: { github: string; leetcode: string; linkedin: string }) {
  const [state, action, pending] = useActionState(updateOwnLinksAction, undefined);
  const v = { github, leetcode, linkedin, ...(state?.values ?? {}) };
  const e = state?.fieldErrors ?? {};
  return (
    <form action={action} className="max-w-md space-y-4" noValidate>
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      {state?.ok ? <Alert kind="success">{state.ok}</Alert> : null}
      <Field id="github" label="GitHub profile" type="url" defaultValue={v.github} error={e.github} hint="Optional, e.g. https://github.com/yourname" />
      <Field id="leetcode" label="LeetCode profile" type="url" defaultValue={v.leetcode} error={e.leetcode} hint="Optional, e.g. https://leetcode.com/u/yourname" />
      <Field id="linkedin" label="LinkedIn profile" type="url" defaultValue={v.linkedin} error={e.linkedin} hint="Optional, e.g. https://www.linkedin.com/in/yourname" />
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save profile links"}</Button>
      <p className="text-xs text-muted">Placement staff and your department coordinator can see these links. Leave a box empty to remove a link.</p>
    </form>
  );
}
