import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { ManualPlacementList } from "@/components/placements/manual-placement-list";
import { uuidSchema } from "@/lib/validation";
import { requireRole } from "@/server/auth/session";
import { companyChoices, manualPlacements, recordableStudents } from "@/server/manual-placements/queries";
import { RecordOfferForm } from "@/components/placements/record-offer-form";

export const metadata = { title: "Company — CampusConnect" };

export default async function CoordinatorCompany({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ recorded?: string }> }) {
  const s = await requireRole("COORDINATOR");
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const company = (await companyChoices(s)).find((c) => c.id === id);
  if (!company) notFound();
  const [students, rows] = await Promise.all([recordableStudents(s), manualPlacements(s, id)]);
  const { recorded } = await searchParams;
  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href="/coordinator/companies" className="underline">← Companies</Link></p>
      <h1>{company.name}</h1>
      {recorded ? <Alert kind="success">Recorded. The placement office will verify it.</Alert> : null}
      <Card title="Add a student offer">
        {students.length === 0 ? <p className="text-sm text-muted">You have no students in your departments yet.</p> : <RecordOfferForm company={id} students={students} officer={false} />}
      </Card>
      <Card title="Placements recorded for this company"><ManualPlacementList rows={rows} showCompany={false} /></Card>
    </div>
  );
}
