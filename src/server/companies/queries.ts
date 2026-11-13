import { sql, type RawBuilder } from "kysely";
import { PAGE_SIZE } from "@/components/ui/pagination";
import { likePattern } from "@/lib/validation";
import { withSession, type SessionUser } from "../auth/session";

// Reads run under RLS: placement officers and college admins see their own college's companies, nobody else sees any.
const n = (v: unknown) => Number(v ?? 0);

export type CompanyRow = { id: string; name: string; industry: string | null; location: string | null; contact_person: string | null; status: string; updated_at: Date };

export async function listCompanies(s: SessionUser, f: { q?: string; status?: string; industry?: string; page: number }) {
  return withSession(s, async (t) => {
    const c: RawBuilder<unknown>[] = [];
    if (f.status === "ACTIVE" || f.status === "INACTIVE") c.push(sql`status = ${f.status}`);
    if (f.industry) c.push(sql`industry = ${f.industry}`);
    if (f.q) c.push(sql`(name::text ILIKE ${likePattern(f.q)} ESCAPE '\\' OR industry ILIKE ${likePattern(f.q)} ESCAPE '\\' OR location ILIKE ${likePattern(f.q)} ESCAPE '\\' OR contact_person ILIKE ${likePattern(f.q)} ESCAPE '\\')`);
    const w = c.length ? sql`WHERE ${sql.join(c, sql` AND `)}` : sql``;
    const total = n((await sql<{ n: number }>`SELECT count(*)::int AS n FROM companies ${w}`.execute(t)).rows[0].n);
    const rows = (await sql<CompanyRow>`SELECT id, name::text AS name, industry, location, contact_person, status, updated_at FROM companies ${w} ORDER BY name, id LIMIT ${PAGE_SIZE} OFFSET ${(f.page - 1) * PAGE_SIZE}`.execute(t)).rows;
    const industries = (await sql<{ industry: string }>`SELECT DISTINCT industry FROM companies WHERE industry IS NOT NULL ORDER BY industry`.execute(t)).rows.map((r) => r.industry);
    return { rows, total, industries };
  });
}

export type CompanyDetail = { id: string; name: string; website: string | null; industry: string | null; description: string | null; contact_person: string | null; contact_email: string | null; contact_phone: string | null; location: string | null; status: string; created_at: Date; updated_at: Date };

export async function getCompany(s: SessionUser, id: string) {
  return withSession(s, async (t) => {
    const company = (await sql<CompanyDetail>`SELECT id, name::text AS name, website, industry, description, contact_person, contact_email::text AS contact_email, contact_phone, location, status, created_at, updated_at FROM companies WHERE id = ${id}`.execute(t)).rows[0];
    if (!company) return null;
    const events = (await sql<{ event: string; actor_name: string; detail: string | null; occurred_at: Date }>`SELECT event, actor_name, detail, occurred_at FROM company_events WHERE company_id = ${id} ORDER BY id DESC`.execute(t)).rows;
    return { company, events };
  });
}

export async function companyStats(s: SessionUser) {
  return withSession(s, async (t) => {
    const c = (await sql<{ total: number; active: number; inactive: number }>`SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'ACTIVE')::int AS active, count(*) FILTER (WHERE status = 'INACTIVE')::int AS inactive FROM companies`.execute(t)).rows[0];
    const recent = (await sql<{ id: string; name: string; updated_at: Date }>`SELECT id, name::text AS name, updated_at FROM companies ORDER BY updated_at DESC LIMIT 5`.execute(t)).rows;
    return { ...c, recent };
  });
}
