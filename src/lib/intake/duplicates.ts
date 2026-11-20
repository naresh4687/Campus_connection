/** Possible duplicates of an announcement. A warning only: staff may view the existing record or carry on; nothing is merged or overwritten. */
const words = (s: string) => new Set(s.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length >= 3));
export function jaccard(a: string, b: string): number {
  const x = words(a), y = words(b); if (!x.size || !y.size) return 0;
  let inter = 0; for (const w of x) if (y.has(w)) inter++;
  return inter / (x.size + y.size - inter);
}
const alnum = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\b(?:pvt|private|ltd|limited|inc|llp|technologies|technology|solutions|systems)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
const sameCompany = (a: string, b: string) => { const x = alnum(a), y = alnum(b); return !!x && !!y && (x === y || x.includes(y) || y.includes(x)); };

export type DriveRow = { id: string; company_name: string; job_title: string; status: string; years: number[]; application_deadline: Date | string | null };
export type IntakeRow = { id: string; source_hash: string; source_text: string; drive_id: string | null; status: string; submitted_at: Date | string };
export type Duplicate = { kind: "DRIVE" | "INTAKE"; id: string; reason: string; score: number; label: string };

export function findDuplicates(input: { company?: string | null; title?: string | null; years?: number[]; sourceHash: string; sourceText: string; selfIntake?: string; selfDrive?: string | null }, drives: DriveRow[], intakes: IntakeRow[]): Duplicate[] {
  const out: Duplicate[] = [];
  for (const i of intakes) {
    if (i.id === input.selfIntake || i.status === "DISCARDED") continue;
    if (i.source_hash === input.sourceHash) out.push({ kind: "INTAKE", id: i.id, reason: "This exact announcement was already submitted.", score: 1, label: `Submitted ${new Date(i.submitted_at).toISOString().slice(0, 10)}` });
    else { const s = jaccard(i.source_text, input.sourceText); if (s >= 0.8) out.push({ kind: "INTAKE", id: i.id, reason: `A very similar announcement was already submitted (${Math.round(s * 100)}% of the same words).`, score: s, label: `Submitted ${new Date(i.submitted_at).toISOString().slice(0, 10)}` }); }
  }
  if (input.company) {
    for (const d of drives) {
      if (d.id === input.selfDrive || d.status === "ARCHIVED" || !sameCompany(d.company_name, input.company)) continue;
      const yearOverlap = !input.years?.length || !d.years.length || d.years.some((y) => input.years!.includes(y));
      const t = input.title ? jaccard(d.job_title, input.title) : 0;
      if (yearOverlap && t >= 0.5) out.push({ kind: "DRIVE", id: d.id, reason: "Same company, similar role and the same batch.", score: 0.9, label: `${d.company_name} — ${d.job_title} (${d.status.toLowerCase()})` });
      else if (yearOverlap && input.years?.length && d.years.length) out.push({ kind: "DRIVE", id: d.id, reason: "Same company and batch (a different role).", score: 0.5, label: `${d.company_name} — ${d.job_title} (${d.status.toLowerCase()})` });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 8);
}
