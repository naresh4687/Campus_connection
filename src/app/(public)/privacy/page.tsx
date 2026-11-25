import { Alert } from "@/components/ui/alert";
import { OperatorDetails } from "@/components/operator-details";

export const metadata = { title: "Privacy policy — CampusConnect" };

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-5 px-4 py-14 text-[0.97rem] leading-7 sm:py-20">
      <h1 className="display text-[clamp(2.4rem,7vw,4rem)] pb-2">Privacy policy</h1>
      <Alert>Draft for the early-access phase. It describes what the product does today and has not yet been reviewed by legal counsel. It will be finalised, including retention periods and the data-protection agreement with each college, before real student data is processed.</Alert>

      <h2 className="border-t border-border pt-6 text-xl font-semibold">What we collect today</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li><strong>College applications:</strong> college name, official email, address, state, district, website, contact person&apos;s name, phone number, college type and approximate student strength.</li>
        <li><strong>Contact messages:</strong> your name, email, optional organisation and your message.</li>
        <li><strong>Accounts:</strong> name, email address and a salted, slow hash of your password (we never store the password itself). Sign-in sessions and security logs record when you signed in and from which browser.</li>
        <li><strong>When a college uses CampusConnect for its students:</strong> student name, college email, register number, department, degree and batch, optional personal email and phone, academic marks (CGPA, board percentages, backlogs) with their verification history, uploaded documents (résumé, mark sheets, certificates, offer letters, joining proofs), and placement activity (registrations, round results, offers, joining and verification).</li>
        <li><strong>Optional student details:</strong> GitHub, LeetCode and LinkedIn profile links, achievements, career preferences, screenshots confirming a registration on a company&apos;s own form, and attendance at on-campus drives.</li>
        <li><strong>Push notifications (only if you turn them on):</strong> the address and keys your browser&apos;s push service gives us, and a short device label such as the browser and operating system. Messages are delivered through that service (run by your browser&apos;s maker). You can turn them off at any time in notification preferences.</li>
        <li><strong>Security data:</strong> to limit abuse we store keyed hashes of email addresses and network addresses in rate-limit and audit records, not the raw values.</li>
      </ul>

      <h2 className="border-t border-border pt-6 text-xl font-semibold">Why we use it</h2>
      <p>To review college applications, to operate accounts and keep them secure, to answer messages, and to keep an audit trail of administrative actions. We do not sell personal data and we do not use it for advertising.</p>

      <h2 className="border-t border-border pt-6 text-xl font-semibold">Student and placement data</h2>
      <p>When a college uses CampusConnect for its students, the college decides what is collected and why, and CampusConnect processes that data on the college&apos;s behalf. Each college&apos;s data is held in its own workspace and is not visible to other colleges. Platform administrators do not have routine access to students&apos; private documents.</p>

      <h2 className="border-t border-border pt-6 text-xl font-semibold">Your choices and rights</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li><strong>See and download:</strong> signed-in students can download their data from “My data”.</li>
        <li><strong>Correct:</strong> students can edit contact details and links, and resubmit academic details; ask the college to correct the rest.</li>
        <li><strong>Delete:</strong> students can ask for deletion from “My data”. The college administrator reviews it. When approved, identifying details and uploaded files are removed and the account can no longer be used; anonymous placement figures and the security log are kept.</li>
        <li><strong>Everyone else</strong> (staff, college applicants, people who wrote to us): ask using the contact below.</li>
      </ul>

      <h2 className="border-t border-border pt-6 text-xl font-semibold">How long we keep data (proposed)</h2>
      <p>This is a proposed schedule, not yet agreed with colleges, and nothing is deleted automatically today: student records and files, until three years after the student’s passing year; unsuccessful college applications and contact messages, one year; security and audit logs, three years. Until it is agreed and applied, data is kept until deletion is requested.</p>

      <h2 className="border-t border-border pt-6 text-xl font-semibold">Students under 18</h2>
      <p>A college must obtain consent from a parent or guardian before creating an account for a student under 18, and keep a record of it. CampusConnect does not collect dates of birth or check ages, and does not track students or show them advertising.</p>

      <h2 className="border-t border-border pt-6 text-xl font-semibold">Contact and complaints</h2>
      <OperatorDetails />

      <h2 className="border-t border-border pt-6 text-xl font-semibold">Where data is stored and who can access it</h2>
      <p>Data is stored in a PostgreSQL database; uploaded files are kept in a private file store and are opened only through short-lived links issued after an access check. Access is limited by role, enforced in the application and in the database, and the people who open a student&apos;s documents are recorded. Sensitive administrative actions, report downloads and use of the optional AI helper are recorded in an append-only audit log. Files are not yet scanned for malware.</p>

      <h2 className="border-t border-border pt-6 text-xl font-semibold">Optional AI helper</h2>
      <p>If a college&apos;s installation switches it on, a placement officer may paste a company announcement and an AI service reads it to suggest values for a draft drive. Only the pasted text is sent; it is not stored, and the audit log keeps only counts. Officers are told not to paste students&apos; personal data. The helper cannot publish anything or decide who is eligible.</p>

      <h2 className="border-t border-border pt-6 text-xl font-semibold">Cookies and browser storage</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li><strong>Sign-in cookies:</strong> one for each kind of account you are signed in to in this browser. They are essential for signing in and expire after at most 12 hours.</li>
        <li><strong>Theme cookie:</strong> set only if you change between light and dark, to remember the choice for up to a year.</li>
        <li><strong>Browser storage:</strong> remembers that you dismissed the prompts to install the app or turn on notifications, and helps the app reload after an update. The installable app also keeps its offline page on your device.</li>
      </ul>
      <p>None of these are used for tracking, and we do not run advertising or analytics cookies.</p>
    </main>
  );
}
