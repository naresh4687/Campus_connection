import Link from "next/link";
import { Alert } from "@/components/ui/alert";

export const metadata = { title: "Privacy policy — CampusConnect" };

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-5 px-4 py-14 text-sm leading-6">
      <h1 className="text-3xl font-semibold tracking-tight">Privacy policy</h1>
      <Alert>Draft for the early-access phase. It describes what the product does today and has not yet been reviewed by legal counsel. It will be finalised, including retention periods and the data-protection agreement with each college, before real student data is processed.</Alert>

      <h2 className="pt-2 text-lg font-semibold">What we collect today</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li><strong>College applications:</strong> college name, official email, address, state, district, website, contact person&apos;s name, phone number, college type and approximate student strength.</li>
        <li><strong>Contact messages:</strong> your name, email, optional organisation and your message.</li>
        <li><strong>Accounts:</strong> name, email address and a salted, slow hash of your password (we never store the password itself). Sign-in sessions and security logs record when you signed in and from which browser.</li>
        <li><strong>When a college uses CampusConnect for its students:</strong> student name, college email, register number, department, degree and batch, optional personal email and phone, academic marks (CGPA, board percentages, backlogs) with their verification history, uploaded documents (résumé, mark sheets, certificates, offer letters, joining proofs), and placement activity (registrations, round results, offers, joining and verification).</li>
        <li><strong>Security data:</strong> to limit abuse we store keyed hashes of email addresses and network addresses in rate-limit and audit records, not the raw values.</li>
      </ul>

      <h2 className="pt-2 text-lg font-semibold">Why we use it</h2>
      <p>To review college applications, to operate accounts and keep them secure, to answer messages, and to keep an audit trail of administrative actions. We do not sell personal data and we do not use it for advertising.</p>

      <h2 className="pt-2 text-lg font-semibold">Student and placement data</h2>
      <p>When a college uses CampusConnect for its students, the college decides what is collected and why, and CampusConnect processes that data on the college&apos;s behalf. Each college&apos;s data is held in its own workspace and is not visible to other colleges. Platform administrators do not have routine access to students&apos; private documents.</p>

      <h2 className="pt-2 text-lg font-semibold">Retention and your rights</h2>
      <p>Retention periods and deletion procedures are being defined with the first colleges and will be stated here. Until then, write to us through the <Link href="/contact" className="underline">contact form</Link> to ask what we hold about you or to request correction or deletion.</p>

      <h2 className="pt-2 text-lg font-semibold">Where data is stored and who can access it</h2>
      <p>Data is stored in a PostgreSQL database; uploaded files are kept in a private file store and are opened only through short-lived links issued after an access check. Access is limited by role, enforced in the application and in the database, and the people who open a student&apos;s documents are recorded. Sensitive administrative actions, report downloads and use of the optional AI helper are recorded in an append-only audit log. Files are not yet scanned for malware.</p>

      <h2 className="pt-2 text-lg font-semibold">Optional AI helper</h2>
      <p>If a college&apos;s installation switches it on, a placement officer may paste a company announcement and an AI service reads it to suggest values for a draft drive. Only the pasted text is sent; it is not stored, and the audit log keeps only counts. Officers are told not to paste students&apos; personal data. The helper cannot publish anything or decide who is eligible.</p>

      <h2 className="pt-2 text-lg font-semibold">Cookies</h2>
      <p>We use one essential cookie to keep you signed in. It is not used for tracking, and we do not run advertising or analytics cookies.</p>
    </main>
  );
}
