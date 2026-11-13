import { parsePage } from "@/components/ui/pagination";
import { requireRole } from "@/server/auth/session";
import { listCompanies } from "@/server/companies/queries";
import { CompanyList } from "../../placement/companies/company-list";

export const metadata = { title: "Companies — CampusConnect" };

export default async function AdminCompanies({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; industry?: string; page?: string }> }) {
  const s = await requireRole("COLLEGE_ADMIN");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 100) || undefined;
  const page = parsePage(sp.page);
  const { rows, total, industries } = await listCompanies(s, { q, status: sp.status, industry: sp.industry || undefined, page });
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">Companies</h1>
      <p className="text-sm text-muted">Read-only oversight. Placement officers manage companies.</p>
      <CompanyList base="/college/companies" rows={rows} total={total} industries={industries} q={q} status={sp.status} industry={sp.industry || undefined} page={page} />
    </div>
  );
}
