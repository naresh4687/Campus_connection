import Link from "next/link";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState, Table, Td } from "@/components/ui/table";
import { StatStrip } from "@/components/ui/stat-strip";
import { requireRole } from "@/server/auth/session";
import { dashboard } from "@/server/college/queries";
import { listDepartments } from "@/server/college/queries";
import { DepartmentForm } from "./department-forms";

export const metadata = { title: "Departments — CampusConnect" };

export default async function DepartmentsPage() {
  const s = await requireRole("COLLEGE_ADMIN");
  const rows = await listDepartments(s);
  const dep = (await dashboard(s)).dep;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Departments</h1>
      <StatStrip label="Department totals" items={[{ label: "Active departments", value: dep.active }, { label: "Inactive departments", value: dep.inactive }, { label: "Departments without a coordinator", value: dep.without_coordinator, attention: true }]} />
      <Table head={["Code", "Department", "Students", "Coordinators", "Status"]} empty={rows.length === 0 ? <EmptyState title="No departments yet">Add your first department below.</EmptyState> : undefined}>
        {rows.map((d) => (
          <tr key={d.id}>
            <Td className="font-mono">{d.code}</Td>
            <Td><Link href={`/college/departments/${d.id}`} className="font-medium underline">{d.name}</Link></Td>
            <Td><Link href={`/college/students?dept=${d.id}`} className="underline" data-testid={`dept-students-${d.code}`}>{d.students}</Link></Td>
            <Td>{d.coordinators === 0 ? <span className="text-muted">None assigned</span> : d.coordinators}</Td>
            <Td><StatusBadge value={d.status} /></Td>
          </tr>
        ))}
      </Table>
      <Card title="Add a department"><DepartmentForm /></Card>
    </div>
  );
}
