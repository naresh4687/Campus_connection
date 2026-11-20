import { Card } from "@/components/ui/card";
import { AchievementList } from "@/components/students/achievement-list";
import { requireRole } from "@/server/auth/session";
import { achievementsFor } from "@/server/achievements/queries";
import { AchievementForm, ReviseAchievement, WithdrawAchievement } from "./achievement-form";

export const metadata = { title: "Achievements — CampusConnect" };

export default async function StudentAchievements() {
  const s = await requireRole("STUDENT");
  const items = (await achievementsFor(s)).filter((a) => a.status !== "WITHDRAWN");
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Achievements</h1>
      <p className="text-sm text-muted">Certifications, hackathons, internships, projects and publications. A coordinator of your department verifies each entry; until then it is shown as awaiting review. A pending entry can be withdrawn. A verified entry can be edited: the change is reviewed, and the verified entry stays as it is until a coordinator verifies the change. A returned entry can be added again.</p>
      <Card title="Add an achievement"><AchievementForm /></Card>
      <Card title="Your achievements">
        <AchievementList items={items} actions={(a) => (a.status === "SUBMITTED" ? <WithdrawAchievement id={a.id} /> : a.status === "VERIFIED" && !a.has_open_revision ? <ReviseAchievement a={a} /> : null)} />
      </Card>
    </div>
  );
}
