"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordOffersBatchAction, type BatchRow } from "@/server/manual-placements/actions";
import type { PickableStudent } from "@/server/manual-placements/queries";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type Row = { id: string; ctc: string; offer: "OFFERED" | "ACCEPTED"; joined: string; note: string; error?: string };

/**
 * Add several students' offers for one company at once. Search (Enter adds the first match), add students, give each their own package and status.
 * A student who already accepted elsewhere cannot be set to "Accepted" (and says where). Each student is saved on its own: refused rows stay in the form with the reason.
 */
export function RecordOfferForm({ company, students, officer }: { company: string; students: PickableStudent[]; officer: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(""); const [dept, setDept] = useState("");
  const [rows, setRows] = useState<Row[]>([]); const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [all, setAll] = useState(""); const search = useRef<HTMLInputElement>(null);
  const byId = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const depts = useMemo(() => [...new Set(students.map((s) => s.department_code))].sort(), [students]);
  const chosen = new Set(rows.map((r) => r.id));
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    return students.filter((s) => !chosen.has(s.id) && (!dept || s.department_code === dept) && (!t || s.full_name.toLowerCase().includes(t) || s.register_number.toLowerCase().includes(t)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, dept, students, rows]);
  const add = (id: string) => { setRows((r) => [...r, { id, ctc: all, offer: "OFFERED", joined: "", note: "" }]); setMsg(null); setQ(""); search.current?.focus(); };
  const patch = (id: string, p: Partial<Row>) => setRows((r) => r.map((x) => (x.id === id ? { ...x, ...p, error: undefined } : x)));
  const ready = rows.length > 0 && rows.every((r) => Number(r.ctc.replace(",", ".")) > 0);
  const submit = () => {
    setMsg(null);
    start(async () => {
      const res = await recordOffersBatchAction(company, rows.map<BatchRow>((r) => ({ student: r.id, ctc: r.ctc, offer: r.offer, joined: r.joined, note: r.note })));
      if (res.error) { setMsg({ kind: "error", text: res.error }); return; }
      const failedIds = new Map(res.failed.map((f) => [f.student, f.message]));
      setRows((cur) => cur.filter((r) => failedIds.has(r.id)).map((r) => ({ ...r, error: failedIds.get(r.id) })));
      if (res.added) router.refresh();
      setMsg(res.failed.length
        ? { kind: res.added ? "success" : "error", text: `${res.added ? `${res.added} offer${res.added === 1 ? "" : "s"} recorded. ` : ""}${res.failed.length} could not be saved: see the reason on each student below and fix or remove it.` }
        : { kind: "success", text: `${res.added} offer${res.added === 1 ? "" : "s"} recorded.` });
    });
  };
  return (
    <div className="space-y-5" data-testid="offer-batch">
      {msg ? <Alert kind={msg.kind}>{msg.text}</Alert> : null}
      <div className="grid gap-3 @xl:grid-cols-[1fr_12rem]">
        <div className="space-y-1.5"><label htmlFor="student-search" className="block text-sm font-semibold">Find students</label>
          <input id="student-search" ref={search} type="search" placeholder="Search by name or register number, then press Enter" value={q} autoComplete="off" onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (matches[0]) add(matches[0].id); } }} className="h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm" /></div>
        <div className="space-y-1.5"><label htmlFor="student-dept" className="block text-sm font-semibold">Department</label>
          <select id="student-dept" value={dept} onChange={(e) => setDept(e.target.value)} className="h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm"><option value="">All departments</option>{depts.map((d) => <option key={d} value={d}>{d}</option>)}</select></div>
      </div>
      <ul className="max-h-60 divide-y divide-border overflow-auto rounded-xl border border-border" aria-label="Students you can add">
        {matches.slice(0, 40).map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <span className="min-w-0"><span className="font-medium">{s.full_name}</span> <span className="text-muted">· {s.register_number} · {s.department_code}</span>
              <span className="block text-xs text-muted">{s.offers === 0 ? "No offers yet" : `${s.offers} offer${s.offers === 1 ? "" : "s"}`}{s.accepted_company ? ` · accepted at ${s.accepted_company}` : ""}</span></span>
            <button type="button" onClick={() => add(s.id)} aria-label={`Add ${s.register_number}`} className="inline-flex h-9 shrink-0 items-center rounded-lg border border-border bg-surface px-3 text-sm font-semibold hover:bg-tint">Add</button>
          </li>))}
        {matches.length === 0 ? <li className="px-3 py-3 text-sm text-muted">{students.length === chosen.size ? "Every student is already added." : "No student matches. Try another name, number or department."}</li> : null}
        {matches.length > 40 ? <li className="px-3 py-2 text-xs text-muted">Showing the first 40 of {matches.length}. Type more of the name or number to narrow it down.</li> : null}
      </ul>

      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h3 className="text-sm">Offers to record ({rows.length})</h3>
          {rows.length > 1 ? <div className="flex items-end gap-2"><label className="text-xs font-semibold" htmlFor="same-ctc">Same LPA for all</label>
            <input id="same-ctc" inputMode="decimal" placeholder="6.5" value={all} onChange={(e) => setAll(e.target.value)} className="h-9 w-24 rounded-lg border border-border bg-surface px-2 text-sm" />
            <button type="button" onClick={() => setRows((r) => r.map((x) => ({ ...x, ctc: all })))} disabled={!all} className="h-9 rounded-lg border border-border bg-surface px-3 text-sm font-semibold hover:bg-tint disabled:opacity-50">Apply</button></div> : null}
        </div>
        {rows.length === 0 ? <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted">Add one or more students above. Each gets their own package and status.</p> : (
          <ul className="space-y-3" aria-label="Offers to record">
            {rows.map((r) => {
              const s = byId.get(r.id)!; const blocked = !!s.accepted_company;
              return (
                <li key={r.id} className={`rounded-xl border p-3 ${r.error ? "border-danger" : "border-border"}`} data-testid={`row-${s.register_number}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><p className="font-semibold">{s.full_name} <span className="text-sm font-normal text-muted">· {s.register_number} · {s.department_code}</span></p>
                      <p className="text-xs text-muted">{s.offers === 0 ? "No offers recorded yet" : `${s.offers} offer${s.offers === 1 ? "" : "s"} recorded`}{blocked ? ` · already accepted at ${s.accepted_company}` : ""}</p></div>
                    <button type="button" onClick={() => setRows((x) => x.filter((y) => y.id !== r.id))} aria-label={`Remove ${s.register_number}`} className="shrink-0 rounded-lg border border-border px-2.5 py-1 text-sm hover:bg-tint">Remove</button>
                  </div>
                  <div className="mt-3 grid gap-3 @xl:grid-cols-[9rem_1fr_1fr]">
                    <label className="space-y-1 text-xs font-semibold">Package (LPA)<input aria-label={`Package (LPA) for ${s.register_number}`} inputMode="decimal" placeholder="6.5" value={r.ctc} onChange={(e) => patch(r.id, { ctc: e.target.value })} className="mt-1 h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm font-normal" /></label>
                    <div role="radiogroup" aria-label={`Status for ${s.register_number}`} className="grid grid-cols-2 gap-2 self-end">
                      <button type="button" role="radio" aria-checked={r.offer === "OFFERED"} onClick={() => patch(r.id, { offer: "OFFERED" })} className={`h-10 rounded-lg border px-2 text-sm font-semibold ${r.offer === "OFFERED" ? "border-foreground bg-brand text-brand-foreground" : "border-border bg-surface"}`}>Got offer</button>
                      <button type="button" role="radio" aria-checked={r.offer === "ACCEPTED"} disabled={blocked} title={blocked ? `Already accepted at ${s.accepted_company}` : undefined} onClick={() => patch(r.id, { offer: "ACCEPTED" })} className={`h-10 rounded-lg border px-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${r.offer === "ACCEPTED" ? "border-foreground bg-brand text-brand-foreground" : "border-border bg-surface"}`}>Accepted offer</button>
                    </div>
                    <label className="space-y-1 text-xs font-semibold">Joining date (optional)<input type="date" value={r.joined} onChange={(e) => patch(r.id, { joined: e.target.value })} className="mt-1 h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm font-normal" /></label>
                  </div>
                  <input aria-label={`Note for ${s.register_number} (optional)`} placeholder="Note (optional)" maxLength={300} value={r.note} onChange={(e) => patch(r.id, { note: e.target.value })} className="mt-3 h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm" />
                  {r.error ? <p className="mt-2 text-sm font-medium text-danger" role="alert">{r.error}</p> : null}
                </li>);
            })}
          </ul>)}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={submit} disabled={!ready || pending} pending={pending}>{pending ? "Saving…" : rows.length > 1 ? `Record ${rows.length} offers` : "Record offer"}</Button>
        {!ready && rows.length > 0 ? <span className="text-xs text-muted">Enter a package for every student to continue.</span> : null}
      </div>
      <p className="text-xs text-muted">{officer ? "Saved as verified; each student is notified." : "A placement officer verifies each one before it is counted; the student is told once it is verified."} A student can have offers from many companies but only one accepted offer.</p>
    </div>
  );
}
