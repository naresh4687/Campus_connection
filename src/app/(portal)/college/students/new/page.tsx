import Link from "next/link";
import { Card } from "@/components/ui/card";
import { requireRole } from "@/server/auth/session";
import { activeDepartments } from "@/server/students/queries";
import { StudentForm } from "../student-form";

export const metadata = { title: "Add student — CampusConnect" };

export default async function NewStudentPage() {
  const s = await requireRole("COLLEGE_ADMIN");
  const depts = (await activeDepartments(s)).filter((d) => d.status === "ACTIVE");
  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href="/college/students" className="underline">← Students</Link></p>
      <h1 className="text-2xl font-semibold tracking-tight">Add a student</h1>
      {depts.length === 0 ? (
        <Card><p className="text-sm">There are no active departments yet. <Link href="/college/departments" className="underline">Create a department</Link> first.</p></Card>
      ) : (
        <Card><StudentForm departments={depts} /><p className="mt-4 text-xs text-muted">Adding a student creates their record only. Invite them afterwards to let them sign in.</p></Card>
      )}
    </div>
  );
}
