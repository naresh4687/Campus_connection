import Link from "next/link";
import { parsePage } from "@/components/ui/pagination";
import { requireRole } from "@/server/auth/session";
import { listCompanies } from "@/server/companies/queries";
import { CompanyList } from "./company-list";

export const metadata = { title: "Companies — CampusConnect" };

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; industry?: string; page?: string }> }) {
  const s = await requireRole("PLACEMENT_OFFICER");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 100) || undefined;
  const page = parsePage(sp.page);
  const { rows, total, industries } = await listCompanies(s, { q, status: sp.status, industry: sp.industry || undefined, page });
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Companies</h1>
        <Link href="/placement/companies/new" className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground">Add company</Link>
      </div>
      <CompanyList base="/placement/companies" rows={rows} total={total} industries={industries} q={q} status={sp.status} industry={sp.industry || undefined} page={page} />
    </div>
  );
}
