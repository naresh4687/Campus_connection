import { ReportsView } from "@/components/reports/reports-view";
import { requireRole } from "@/server/auth/session";
import { loadReports, parseYear } from "@/server/reports/queries";

export const metadata = { title: "Reports — CampusConnect" };

export default async function CollegeReports({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const s = await requireRole("COLLEGE_ADMIN");
  const year = parseYear((await searchParams).year);
  return <ReportsView base="/college/reports" data={await loadReports(s, year)} year={year} />;
}
