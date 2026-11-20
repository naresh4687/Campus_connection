import { ContactForm } from "./contact-form";

export const metadata = { title: "Contact — CampusConnect" };

export default function ContactPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-14 sm:py-20">
      <h1 className="display text-[clamp(2.4rem,7vw,4rem)]">Contact</h1>
      <p className="mt-5 text-lg text-muted">Questions about CampusConnect or onboarding your college? Send us a message. It goes to the platform team&apos;s inbox inside the product, and replies are sent manually, so please allow a few days.</p>
      <div className="mt-8 rounded-[1.75rem] border border-border bg-surface p-6 sm:p-8"><ContactForm /></div>
    </main>
  );
}
