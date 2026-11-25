import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fmtDateTime } from "@/lib/format";
import { requireRole } from "@/server/auth/session";
import { myErasure } from "@/server/privacy/queries";
import { CancelForm, RequestForm } from "./forms";

export const metadata = { title: "My data — CampusConnect" };

export default async function MyDataPage() {
  const s = await requireRole("STUDENT");
  const req = await myErasure(s);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">My data</h1>
      <Card title="Download">
        <div className="space-y-3 text-sm">
          <p className="text-muted">A file with the details CampusConnect holds about you. Uploaded files are listed by name; download them from their own pages.</p>
          <a href="/student/privacy/export" download className={buttonClass("primary")}>Download my data</a>
        </div>
      </Card>
      <Card title="Delete my account and data">
        <div className="space-y-3 text-sm">
          <p>Your college administrator reviews the request. If approved, your name, contact details, register number, profile links, achievements and uploaded files are removed and you can no longer sign in. Placement figures stay as anonymous records, and the security log is kept. <strong>This cannot be undone.</strong> Download your data first.</p>
          <p className="text-muted">More in the <Link href="/privacy" className="underline">privacy policy</Link>.</p>
          {req?.status === "PENDING" ? (
            <><Alert kind="info">Your request of {fmtDateTime(req.requested_at)} is waiting for the college administrator.</Alert><CancelForm /></>
          ) : (
            <>
              {req?.status === "DECLINED" ? <Alert kind="info">Your last request was declined: {req.decision_reason}</Alert> : null}
              <RequestForm />
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
