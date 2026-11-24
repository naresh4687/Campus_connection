import { ReportsView } from "@/components/reports/reports-view";
import { parseFilters, type RawFilters } from "@/lib/report-filters";
import { requireRole } from "@/server/auth/session";
import { loadReport } from "@/server/reports/filtered";

export const metadata = { title: "Reports — CampusConnect" };

export default async function CollegeReports({ searchParams }: { searchParams: Promise<RawFilters> }) {
  const s = await requireRole("COLLEGE_ADMIN");
  const f = parseFilters(await searchParams);
  return <ReportsView base="/college/reports" data={await loadReport(s, f, f.view)} f={f} />;
}
