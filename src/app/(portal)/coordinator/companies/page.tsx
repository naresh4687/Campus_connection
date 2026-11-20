import Link from "next/link";
import { Card } from "@/components/ui/card";
import { requireRole } from "@/server/auth/session";
import { companyChoices } from "@/server/manual-placements/queries";

export const metadata = { title: "Companies — CampusConnect" };

export default async function CoordinatorCompanies() {
  const s = await requireRole("COORDINATOR");
  const companies = await companyChoices(s);
  return (
    <div className="space-y-6">
      <h1>Companies</h1>
      <p className="text-sm text-muted">Open a company to record a student of your department as placed there, with the package in LPA. A placement officer verifies each record.</p>
      <Card title="Companies">
        {companies.length === 0 ? <p className="text-sm text-muted">The placement office has not added any company yet.</p> : (
          <ul className="divide-y divide-border" aria-label="Companies">
            {companies.map((c) => <li key={c.id} className="flex items-center justify-between gap-3 py-3"><span className="font-medium">{c.name}{c.industry ? <span className="ml-2 text-sm font-normal text-muted">{c.industry}</span> : null}</span><Link href={`/coordinator/companies/${c.id}`} className="underline">Record a placement</Link></li>)}
          </ul>)}
      </Card>
    </div>
  );
}
