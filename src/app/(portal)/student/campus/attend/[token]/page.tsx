import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { fmtDateTime } from "@/lib/format";
import { requireRole } from "@/server/auth/session";
import { peekCampusToken } from "@/server/campus/queries";
import { MarkButton } from "../../mark-button";

export const metadata = { title: "Mark attendance — CampusConnect" };

/** The page an attendance link opens. A student who is not signed in is sent to the student sign-in by requireRole; after signing in they open the link again. */
export default async function Attend({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Opened while signed out (a link shared in a group chat): requireSession sends them to sign in and brings them back here.
  const s = await requireRole("STUDENT");
  const info = /^[0-9a-f]{64}$/.test(token) ? await peekCampusToken(s, token) : null;
  if (!info) return (
    <div className="mx-auto max-w-lg space-y-4"><h1 className="text-2xl font-semibold tracking-tight">Attendance link</h1><Alert kind="error">This attendance link is not valid. Ask the placement office for the right one.</Alert>
      <Link href="/student/campus" className="underline">Go to my on-campus drives</Link></div>
  );
  const open = info.round_status === "OPEN";
  return (
    <div className="mx-auto max-w-lg space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">Mark your attendance</h1>
      <Card title={`${info.company_name} — round ${info.round_number}: ${info.round_name}`}>
        <p className="text-sm text-muted">{info.title} · {fmtDateTime(info.event_at)}{info.venue ? ` · ${info.venue}` : ""}</p>
        <div className="mt-4 space-y-3">
          {info.present ? <Alert kind="success">You are marked present for this round.</Alert>
            : !info.eligible ? <Alert kind="error">{info.round_number > 1 ? "You are not on the list for this round." : "You are not on the list for this drive. Ask the placement office if you think this is a mistake."}</Alert>
            : !open ? <Alert kind="info">{info.round_status === "PLANNED" ? "Attendance for this round has not opened yet. Try again when the placement office opens it." : "Attendance for this round is closed. Ask the placement office."}</Alert>
            : <MarkButton token={token} />}
          <Link href="/student/campus" className="inline-block text-sm underline">My on-campus drives</Link>
        </div>
      </Card>
    </div>
  );
}
