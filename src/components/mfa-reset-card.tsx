import { ActionButton } from "@/components/ui/action-button";
import { Card } from "@/components/ui/card";
import { resetMfaAction } from "@/server/auth/mfa-actions";

/** Shown only for accounts the viewer may reset (see canResetMfa). */
export function MfaResetCard({ userId }: { userId: string }) {
  return (
    <Card title="Two-step sign-in">
      <p className="mb-3 text-sm text-muted">On for this account. Remove it only after checking it is really them, for example when their phone is lost. It signs them out.</p>
      <ActionButton action={resetMfaAction} fields={{ id: userId }} label="Remove two-step sign-in" variant="danger" pendingLabel="Removing…" />
    </Card>
  );
}
