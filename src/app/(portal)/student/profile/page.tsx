import { Card } from "@/components/ui/card";
import { requireRole } from "@/server/auth/session";
import { myStudentRecord } from "@/server/students/queries";
import { ContactForm } from "./contact-form";

export const metadata = { title: "My profile — CampusConnect" };

export default async function StudentProfile() {
  const s = await requireRole("STUDENT");
  const st = await myStudentRecord(s); // row-level security: a student can only ever read their own record
  if (!st) return (
    <div className="space-y-4"><h1 className="text-2xl font-semibold tracking-tight">My profile</h1><Card><p className="text-sm">Your student record could not be found. Please contact your college administrator.</p></Card></div>
  );
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">My profile</h1>
      <Card title="College record">
        <dl className="grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
          <dt className="text-muted">Name</dt><dd>{st.full_name}</dd>
          <dt className="text-muted">Register number</dt><dd className="font-mono">{st.register_number}</dd>
          <dt className="text-muted">Department</dt><dd>{st.dept_code} — {st.dept_name}</dd>
          <dt className="text-muted">Degree</dt><dd>{st.degree}{st.specialization ? ` · ${st.specialization}` : ""}</dd>
          <dt className="text-muted">Batch</dt><dd>{st.admission_year} – {st.passing_year}</dd>
          <dt className="text-muted">College email</dt><dd>{st.college_email}</dd>
        </dl>
        <p className="mt-3 text-xs text-muted">These details are maintained by your college. If something is wrong, ask your college administrator to correct it.</p>
      </Card>
      <Card title="Contact details"><ContactForm phone={st.phone ?? ""} personalEmail={st.personal_email ?? ""} /></Card>
    </div>
  );
}
