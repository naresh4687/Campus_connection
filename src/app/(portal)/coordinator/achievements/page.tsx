import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Pagination, parsePage } from "@/components/ui/pagination";
import { AchievementList } from "@/components/students/achievement-list";
import { requireRole } from "@/server/auth/session";
import { achievementQueue } from "@/server/achievements/queries";
import { AchievementReview } from "./review-forms";
import { DETAIL_FIELDS, KIND_LABEL, changedFields } from "@/lib/achievements";

export const metadata = { title: "Achievements to review — CampusConnect" };

export default async function AchievementQueue({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const s = await requireRole("COORDINATOR");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 100) || undefined;
  const page = parsePage(sp.page);
  const { rows, total } = await achievementQueue(s, { q, page });
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">Achievements to review</h1>
      <p className="text-sm text-muted">Entries students of your departments have added, oldest first. Verify an entry only if you can confirm it; otherwise return it with a reason.</p>
      <form className="flex flex-wrap items-end gap-3" role="search">
        <div className="space-y-1">
          <label htmlFor="q" className="block text-sm font-medium">Search</label>
          <input id="q" name="q" defaultValue={q} placeholder="Student name or register number" className="h-10 w-64 max-w-full rounded-xl border border-border bg-surface px-3 text-sm" />
        </div>
        <button className="h-10 rounded-xl border border-border bg-surface px-4 text-sm hover:bg-background">Search</button>
        {q ? <Link href="/coordinator/achievements" className="inline-flex h-10 items-center text-sm underline">Clear</Link> : null}
      </form>
      {rows.length === 0 ? <Card><p className="text-sm text-muted">{q ? "No pending entries match." : "Nothing to review. New entries from your students will appear here."}</p></Card> : rows.map((r) => (
        <Card key={r.id} title={`${r.full_name} · ${r.register_number} · ${r.dept_code}`}>
          {r.original ? (
            <div className="mb-3 space-y-1 rounded-xl border border-border p-3 text-sm" data-testid="achievement-diff">
              <p className="font-medium">A change to a verified entry. The verified entry stays in force until you verify this.</p>
              <ul>{changedFields(r.original, { kind: r.kind, title: r.title, achieved_on: r.achieved_on, description: r.description, link: r.link }).map((k) => {
                const label = DETAIL_FIELDS.find((f) => f.key === k)!.label;
                const show = (x: string | null) => (x === null || x === "" ? "(none)" : k === "kind" ? KIND_LABEL[x] ?? x : x);
                const now = { kind: r.kind, title: r.title, achieved_on: r.achieved_on, description: r.description, link: r.link }[k];
                return <li key={k}><span className="text-muted">{label}:</span> <del>{show(r.original![k])}</del> → <ins className="font-medium no-underline">{show(now)}</ins></li>;
              })}</ul>
            </div>
          ) : null}
          <AchievementList items={[r]} actions={(a) => <AchievementReview id={a.id} />} />
        </Card>
      ))}
      <Pagination page={page} total={total} basePath="/coordinator/achievements" params={{ q }} />
    </div>
  );
}
