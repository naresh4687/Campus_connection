import Link from "next/link";
import { FEATURES, NOT_INCLUDED } from "@/lib/site-content";

export const metadata = { title: "Features — CampusConnect" };

export default function FeaturesPage() {
  const available = FEATURES.filter((f) => f.status === "available");
  const coming = FEATURES.filter((f) => f.status === "in-development");
  const Card = ({ f }: { f: (typeof FEATURES)[number] }) => (
    <li className="rounded-2xl border border-border bg-surface p-5">
      <p className="font-medium">{f.title}</p>
      <p className="mt-1 text-sm text-muted">{f.description}</p>
    </li>
  );
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-14">
      <h1 className="text-3xl font-semibold tracking-tight">Features</h1>
      <p className="mt-3 max-w-2xl text-muted">CampusConnect is in early access. Everything under “Available now” is built and tested; the list after it says what is not included, so you know exactly what to expect.</p>

      <h2 className="mt-10 text-xl font-semibold">Available now</h2>
      <ul className="mt-4 grid gap-4 sm:grid-cols-2" aria-label="Available now">{available.map((f) => <Card key={f.title} f={f} />)}</ul>

      {coming.length > 0 ? <>
        <h2 className="mt-10 text-xl font-semibold">In development</h2>
        <p className="mt-1 text-sm text-muted">Planned for the product; not usable yet.</p>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2" aria-label="In development">{coming.map((f) => <Card key={f.title} f={f} />)}</ul>
      </> : null}

      <h2 className="mt-10 text-xl font-semibold">Not included yet</h2>
      <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-muted" aria-label="Not included yet">{NOT_INCLUDED.map((t) => <li key={t}>{t}</li>)}</ul>

      <p className="mt-10 text-sm text-muted">Interested? <Link href="/apply" className="underline">Apply as a college</Link> or <Link href="/contact" className="underline">get in touch</Link>.</p>
    </main>
  );
}
