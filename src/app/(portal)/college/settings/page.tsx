import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { COLLEGE_TYPES } from "@/lib/india";
import { requireRole } from "@/server/auth/session";
import { getCollegeProfile } from "@/server/college/queries";
import { ProfileForm } from "./profile-form";

export const metadata = { title: "College profile — CampusConnect" };

export default async function SettingsPage() {
  const s = await requireRole("COLLEGE_ADMIN");
  const c = await getCollegeProfile(s);
  if (!c) return <p className="text-sm">College not found.</p>;
  const type = COLLEGE_TYPES.find((t) => t.value === c.college_type)?.label ?? c.college_type ?? "—";
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">College profile</h1>
      <Card title="Identity">
        <dl className="grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
          <dt className="text-muted">College name</dt><dd>{c.name}</dd>
          <dt className="text-muted">Official email</dt><dd>{c.official_email ?? "—"}</dd>
          <dt className="text-muted">College type</dt><dd>{type}</dd>
          <dt className="text-muted">Access</dt><dd><StatusBadge value={c.status} /></dd>
        </dl>
        <p className="mt-3 text-xs text-muted">Name, official email and type were set when your application was approved. Contact the CampusConnect team to change them.</p>
      </Card>
      <Card title="Contact and location">
        <ProfileForm initial={{ address: c.address ?? "", district: c.district ?? "", state: c.state ?? "", website: c.website ?? "", contactPerson: c.contact_person ?? "", phone: c.contact_phone ?? "", approxStudents: String(c.approx_students ?? "") }} />
      </Card>
    </div>
  );
}
