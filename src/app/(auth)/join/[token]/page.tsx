import Link from "next/link";
import { AuthShell } from "@/components/layout/auth-shell";
import { Alert } from "@/components/ui/alert";
import { parseJoinToken } from "@/server/join/link";
import { peekJoin } from "@/server/join/queries";
import { JoinForm } from "./join-form";

export const metadata = { title: "Student sign-up — CampusConnect" };

export default async function JoinPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string }> }) {
  const { token } = await params; const { done } = await searchParams;
  const link = parseJoinToken(token);
  const page = link ? await peekJoin(link.college, link.version) : null;
  if (!page) {
    return (
      <AuthShell title="Student sign-up">
        <div className="space-y-4 text-sm"><Alert kind="error">This sign-up link is not valid, has been turned off, or has been replaced.</Alert><p>Ask your college for the current link.</p>
          <p className="text-center"><Link href="/login" className="underline">Go to sign in</Link></p></div>
      </AuthShell>
    );
  }
  if (done) {
    return (
      <AuthShell title="Request sent">
        <div className="space-y-4 text-sm"><Alert kind="success">Your request was sent to {page.college_name}.</Alert>
          <p>Your department coordinator or the college administrator will check it. <strong>You can sign in after it is approved</strong> — use the college email and the password you just chose.</p>
          <p className="text-center"><Link href="/login/student" className="underline">Student sign in</Link></p></div>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Student sign-up">
      <div className="space-y-4">
        <p className="text-sm">Create your CampusConnect account for <strong>{page.college_name}</strong>. A coordinator or administrator approves it before you can sign in.</p>
        {page.departments.length === 0 ? <Alert kind="error">This college has not set up its departments yet. Please try again later.</Alert> : <JoinForm token={token} departments={page.departments} />}
        <p className="text-center text-sm text-muted">Already approved? <Link href="/login/student" className="underline">Sign in</Link></p>
      </div>
    </AuthShell>
  );
}
