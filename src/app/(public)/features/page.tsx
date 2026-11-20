import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { FEATURES, NOT_INCLUDED } from "@/lib/site-content";

export const metadata = { title: "Features — CampusConnect" };

export default function FeaturesPage() {
  const available = FEATURES.filter((f) => f.status === "available");
  const coming = FEATURES.filter((f) => f.status === "in-development");
  const Row = ({ f }: { f: (typeof FEATURES)[number] }) => (
    <li className="grid gap-1 border-b border-border py-5 sm:grid-cols-[16rem_1fr] sm:gap-8">
      <h3 className="text-lg">{f.title}</h3>
      <p className="text-muted">{f.description}</p>
    </li>
  );
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-14 sm:py-20">
      <h1 className="display text-[clamp(2.4rem,7vw,4rem)]">Features</h1>
      <p className="mt-5 max-w-2xl text-lg text-muted">CampusConnect is in early access. Everything under “Available now” is built and tested; the list after it says what is not included, so you know exactly what to expect.</p>

      <section className="mt-14 grid gap-6 lg:grid-cols-[14rem_1fr] lg:gap-12">
        <h2 className="text-2xl">Available now</h2>
        <ul className="border-t border-border" aria-label="Available now">{available.map((f) => <Row key={f.title} f={f} />)}</ul>
      </section>

      {coming.length > 0 ? (
        <section className="mt-14 grid gap-6 lg:grid-cols-[14rem_1fr] lg:gap-12">
          <div><h2 className="text-2xl">In development</h2><p className="mt-1 text-sm text-muted">Planned for the product; not usable yet.</p></div>
          <ul className="border-t border-border" aria-label="In development">{coming.map((f) => <Row key={f.title} f={f} />)}</ul>
        </section>
      ) : null}

      <section className="mt-14 rounded-[1.75rem] bg-tint p-6 sm:p-10 lg:grid lg:grid-cols-[14rem_1fr] lg:gap-12">
        <h2 className="text-2xl">Not included yet</h2>
        <ul className="mt-4 space-y-3 lg:mt-0" aria-label="Not included yet">
          {NOT_INCLUDED.map((t) => <li key={t} className="flex gap-3"><span aria-hidden="true" className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground" /><span>{t}</span></li>)}
        </ul>
      </section>

      <div className="mt-14 flex flex-wrap items-center gap-3">
        <Link href="/apply" className={buttonClass("primary", "h-12 px-6 text-base")}>Apply as a college</Link>
        <Link href="/contact" className={buttonClass("secondary", "h-12 px-6 text-base")}>Get in touch</Link>
      </div>
    </main>
  );
}
