import Link from "next/link";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { ACADEMIC_LABEL } from "@/lib/academics";
import { requireRole } from "@/server/auth/session";
import { myAcademicStatus } from "@/server/academics/queries";
import { myStudentRecord } from "@/server/students/queries";
import { myDrives } from "@/server/registrations/queries";
import { myOffers } from "@/server/offers/queries";
import { fmtDateTime } from "@/lib/format";

export const metadata = { title: "Student dashboard — CampusConnect" };

const CTA: Record<string, string> = {
  NOT_SUBMITTED: "Submit your academic details so a coordinator can verify them. You need a verified record before you can register for placement drives.",
  PENDING: "Your academic details are with a coordinator for review.",
  VERIFIED: "Your academic record is verified.",
  REJECTED: "Your last submission was rejected. Open Academics to see the reason and submit a correction.",
};

export default async function StudentHome() {
  const s = await requireRole("STUDENT");
  const [st, ac, drives, offers] = await Promise.all([myStudentRecord(s), myAcademicStatus(s), myDrives(s), myOffers(s)]);
  const now = new Date();
  const openDrives = drives.filter((d) => d.status === "PUBLISHED" && d.application_deadline && new Date(d.application_deadline) > now);
  const canRegister = openDrives.filter((d) => d.result === "ELIGIBLE" && d.registration_status !== "REGISTERED");
  const registered = drives.filter((d) => d.registration_status === "REGISTERED");
  const awaiting = offers.filter((o) => o.offer_status === "ISSUED" && o.response_deadline && new Date(o.response_deadline) > now).sort((a, b) => +new Date(a.response_deadline!) - +new Date(b.response_deadline!));
  const tone = { VERIFIED: "APPROVED", PENDING: "PENDING", REJECTED: "REJECTED", NOT_SUBMITTED: "NOT_STARTED" }[ac.status];
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Student dashboard</h1>
      <Card>
        <p className="text-sm">Welcome, {s.fullName}.</p>
        {st ? (
          <p className="mt-2 text-sm text-muted">{st.degree}, {st.dept_name} · register number <span className="font-mono">{st.register_number}</span> · batch {st.admission_year}–{st.passing_year}. <Link href="/student/profile" className="underline">View or update your profile</Link>.</p>
        ) : <p className="mt-2 text-sm text-muted">Your student record is not linked yet. Please contact your college administrator.</p>}
      </Card>
      <Card title="Academic verification">
        <p className="flex flex-wrap items-center gap-2 text-sm"><StatusBadge value={tone ?? "NOT_STARTED"} label={ACADEMIC_LABEL[ac.status]} />{ac.update_pending ? <StatusBadge value="PENDING" label="Update awaiting review" /> : null}</p>
        <p className="mt-2 text-sm text-muted">{CTA[ac.status]} <Link href="/student/academics" className="underline">Open Academics</Link>.</p>
      </Card>
      {awaiting.length > 0 || canRegister.length > 0 ? (
        <Card title="Needs your attention">
          <ul className="space-y-1 text-sm" aria-label="Needs your attention">
            {awaiting.map((o) => <li key={o.id}><Link href={`/student/offers/${o.id}`} className="underline">Respond to your offer from {o.company_name} by {fmtDateTime(o.response_deadline)}.</Link></li>)}
            {canRegister.length > 0 ? <li><Link href="/student/drives" className="underline">{canRegister.length} open drive{canRegister.length === 1 ? "" : "s"} you are eligible for and have not registered for.</Link></li> : null}
          </ul>
        </Card>
      ) : null}
      <Card title="Placement drives">
        <p className="text-sm" data-testid="drive-summary">{openDrives.length} open drive{openDrives.length === 1 ? "" : "s"} · {registered.length} registered · {offers.length} offer{offers.length === 1 ? "" : "s"}</p>
        <p className="mt-2 text-sm"><Link href="/student/drives" className="underline">Browse placement drives</Link> · <Link href="/student/offers" className="underline">My offers</Link></p>
      </Card>
    </div>
  );
}
