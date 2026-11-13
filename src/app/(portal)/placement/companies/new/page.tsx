import Link from "next/link";
import { Card } from "@/components/ui/card";
import { requireRole } from "@/server/auth/session";
import { CompanyForm } from "../company-form";

export const metadata = { title: "Add company — CampusConnect" };

export default async function NewCompanyPage() {
  await requireRole("PLACEMENT_OFFICER");
  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href="/placement/companies" className="underline">← Companies</Link></p>
      <h1 className="text-2xl font-semibold tracking-tight">Add a company</h1>
      <Card><CompanyForm /></Card>
    </div>
  );
}
