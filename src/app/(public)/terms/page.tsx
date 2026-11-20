import Link from "next/link";
import { Alert } from "@/components/ui/alert";

export const metadata = { title: "Terms of service — CampusConnect" };

export default function TermsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-5 px-4 py-14 text-[0.97rem] leading-7 sm:py-20">
      <h1 className="display text-[clamp(2.4rem,7vw,4rem)] pb-2">Terms of service</h1>
      <Alert>Draft for the early-access phase, not yet reviewed by legal counsel. Final terms, including commercial terms, will be agreed with each college before it goes live.</Alert>

      <h2 className="border-t border-border pt-6 text-xl font-semibold">Early access</h2>
      <p>CampusConnect is under active development and offered to a small number of colleges by application. Features may change, and some described on the <Link href="/features" className="underline">features page</Link> are not yet available. No uptime or support commitment is made during early access unless agreed in writing.</p>

      <h2 className="border-t border-border pt-6 text-xl font-semibold">Accounts</h2>
      <p>Accounts are created by invitation from a college or the platform team; there is no public sign-up. Keep your password private, use a password that is not used elsewhere, and tell your administrator if you suspect misuse. Administrators are responsible for the accounts they create.</p>

      <h2 className="border-t border-border pt-6 text-xl font-semibold">Acceptable use</h2>
      <p>Do not attempt to access data you are not authorised to see, probe the service for weaknesses without permission, upload unlawful or malicious files, or submit false information in an application or placement record.</p>

      <h2 className="border-t border-border pt-6 text-xl font-semibold">Accuracy of records</h2>
      <p>Colleges are responsible for the accuracy of the academic and placement data they enter and verify. CampusConnect applies the rules a college configures; it does not independently verify academic claims.</p>

      <h2 className="border-t border-border pt-6 text-xl font-semibold">Commercial terms</h2>
      <p>Subscription billing is not active. Any commercial arrangement is agreed and recorded manually with the platform team. No payment is taken through the product at this stage.</p>

      <h2 className="border-t border-border pt-6 text-xl font-semibold">Suspension</h2>
      <p>The platform team may suspend a college&apos;s access, with a recorded reason, for example for security or contractual reasons. Suspended colleges&apos; data is retained and access can be restored.</p>

      <h2 className="border-t border-border pt-6 text-xl font-semibold">Contact</h2>
      <p>Questions about these terms: use the <Link href="/contact" className="underline">contact form</Link>.</p>
    </main>
  );
}
