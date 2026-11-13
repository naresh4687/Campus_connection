import { ContactForm } from "./contact-form";

export const metadata = { title: "Contact — CampusConnect" };

export default function ContactPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-14">
      <h1 className="text-3xl font-semibold tracking-tight">Contact</h1>
      <p className="mt-3 text-muted">Questions about CampusConnect or onboarding your college? Send us a message. It goes to the platform team&apos;s inbox inside the product, and replies are sent manually, so please allow a few days.</p>
      <div className="mt-8 rounded-lg border border-border bg-surface p-6 shadow-sm"><ContactForm /></div>
    </main>
  );
}
