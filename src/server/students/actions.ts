"use server";

import { sql } from "kysely";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { mappingProblem, ownContactSchema, ownLinksSchema, STUDENT_FIELDS, studentFormSchema, validateRows, buildDeptLookup, type Mapping } from "@/lib/students";
import { uuidSchema } from "@/lib/validation";
import { dbMessage, firstErrors, GENERIC_ERROR, str, type ActionState } from "../action-utils";
import { invitationLink } from "../auth/links";
import { allow } from "../auth/rate-limit";
import { assertSameOrigin } from "../auth/request";
import { requireRole, withSession } from "../auth/session";
import { hashToken, newToken } from "../auth/tokens";
import { importValidationContext, listInvitable } from "./queries";

const INVITE_TTL_SECONDS = 7 * 24 * 3600;
const BULK_MAX = 500;

async function admin() {
  await assertSameOrigin();
  return requireRole("COLLEGE_ADMIN");
}
const refresh = () => revalidatePath("/college", "layout");

const FORM_FIELDS = ["departmentId", "registerNumber", "fullName", "collegeEmail", "personalEmail", "phone", "degree", "specialization", "admissionYear", "passingYear"] as const;
const readForm = (fd: FormData) => Object.fromEntries(FORM_FIELDS.map((k) => [k, str(fd, k, 400)]));

// ───────────── single student ─────────────
export async function createStudentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await admin();
  const values = readForm(fd);
  const r = studentFormSchema.safeParse(values);
  if (!r.success) return { error: "Please correct the highlighted fields.", fieldErrors: firstErrors(r.error), values };
  const v = r.data;
  let id = "";
  try {
    id = await withSession(s, async (t) =>
      (await sql<{ id: string }>`SELECT students.create_student(${v.departmentId}::uuid, ${v.registerNumber}, ${v.fullName}, ${v.collegeEmail}, ${v.personalEmail ?? null}, ${v.phone ?? null},
        ${v.degree}, ${v.specialization || null}, ${v.admissionYear}, ${v.passingYear}) AS id`.execute(t)).rows[0].id);
  } catch (e) {
    return { error: dbMessage(e), values };
  }
  refresh();
  redirect(`/college/students/${id}?created=1`);
}

export async function updateStudentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await admin();
  const id = uuidSchema.safeParse(str(fd, "id"));
  const values = readForm(fd);
  const r = studentFormSchema.safeParse(values);
  if (!id.success) return { error: GENERIC_ERROR };
  if (!r.success) return { error: "Please correct the highlighted fields.", fieldErrors: firstErrors(r.error), values };
  const v = r.data;
  try {
    await withSession(s, (t) => sql`SELECT students.update_student(${id.data}::uuid, ${v.departmentId}::uuid, ${v.registerNumber}, ${v.fullName}, ${v.collegeEmail}, ${v.personalEmail ?? null}, ${v.phone ?? null},
      ${v.degree}, ${v.specialization || null}, ${v.admissionYear}, ${v.passingYear})`.execute(t));
  } catch (e) {
    return { error: dbMessage(e), values };
  }
  refresh();
  return { ok: "Student saved.", values };
}

export async function inviteStudentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await admin();
  const id = uuidSchema.safeParse(str(fd, "id"));
  const email = str(fd, "email", 300);
  if (!id.success) return { error: GENERIC_ERROR };
  const token = newToken();
  try {
    await withSession(s, (t) => sql`SELECT students.invite_student(${id.data}::uuid, ${hashToken(token)}, ${INVITE_TTL_SECONDS})`.execute(t));
  } catch (e) {
    return { error: dbMessage(e) };
  }
  refresh();
  return { ok: "Invitation created.", invite: { link: await invitationLink(token), email, expires: "expires in 7 days" } };
}

/** Invites every student matching the current filters who has no account and no live invitation (max 500 per run). */
export async function bulkInviteAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await admin();
  const filters = { q: str(fd, "q", 100) || undefined, dept: str(fd, "dept", 40) || undefined, year: str(fd, "year", 8) || undefined, page: 1 };
  if (!(await allow("bulk-invite", s.userId, 10, 3600))) return { error: "Too many bulk invitations. Please wait a while and try again." };
  const { rows, total } = await listInvitable(s, filters, BULK_MAX);
  if (rows.length === 0) return { error: "No students match the current filters who still need an invitation." };
  const tokens = rows.map(() => newToken());
  let outcomes: { student_id: string; outcome: string }[];
  try {
    outcomes = await withSession(s, async (t) =>
      (await sql<{ student_id: string; outcome: string }>`SELECT * FROM students.invite_students(ARRAY[${sql.join(rows.map((r) => sql`${r.id}::uuid`))}]::uuid[], ARRAY[${sql.join(tokens.map((k) => sql`${hashToken(k)}::bytea`))}]::bytea[], ${INVITE_TTL_SECONDS})`.execute(t)).rows);
  } catch (e) {
    return { error: dbMessage(e) };
  }
  const byId = new Map(outcomes.map((o) => [o.student_id, o.outcome]));
  const base = await invitationLink("");
  const table: string[][] = [];
  const notes: string[] = [];
  rows.forEach((r, i) => {
    const o = byId.get(r.id);
    if (o === "OK") table.push([r.register_number, r.full_name, r.college_email, `${base}${tokens[i]}`]);
    else notes.push(`${r.register_number}: ${o === "EMAIL_IN_USE" ? "an account with this email already exists" : o === "HAS_ACCOUNT" ? "already has an account" : "could not be invited"}`);
  });
  if (total > rows.length) notes.push(`${total - rows.length} more matching student(s) were not included (the limit is ${BULK_MAX} per run). Run it again after distributing these links.`);
  refresh();
  return { ok: `${table.length} invitation(s) created.`, table: { headers: ["Register number", "Name", "College email", "Invitation link"], rows: table }, notes };
}

// ───────────── CSV import (the upload itself is a route handler; see import/upload/route.ts) ─────────────
export async function applyMappingAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await admin();
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: GENERIC_ERROR };
  const ctx = await importValidationContext(s, id.data);
  if (!ctx) return { error: "Import not found." };
  if (!["UPLOADED", "VALIDATED"].includes(ctx.status)) return { error: "This import can no longer be changed." };

  const mapping = {} as Mapping;
  const values: Record<string, string> = {};
  for (const f of STUDENT_FIELDS) {
    const raw = str(fd, `map_${f.key}`, 4);
    values[`map_${f.key}`] = raw;
    mapping[f.key] = raw === "" ? null : /^\d{1,2}$/.test(raw) ? Number(raw) : (NaN as number);
  }
  if (Object.values(mapping).some((v) => v !== null && Number.isNaN(v))) return { error: GENERIC_ERROR, values };
  const problem = mappingProblem(mapping, ctx.headers.length);
  if (problem) return { error: problem, values };

  const results = validateRows(ctx.rows, mapping, { depts: buildDeptLookup(ctx.depts), existingRegisters: ctx.existingRegisters, existingEmails: ctx.existingEmails });
  try {
    await withSession(s, (t) => sql`SELECT students.save_validation(${id.data}::uuid, ${JSON.stringify(mapping)}::jsonb, ${JSON.stringify(results)}::jsonb)`.execute(t));
  } catch (e) {
    return { error: dbMessage(e), values };
  }
  refresh();
  redirect(`/college/students/import/${id.data}`);
}

export async function commitImportAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await admin();
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: GENERIC_ERROR };
  try {
    await withSession(s, (t) => sql`SELECT students.commit_import(${id.data}::uuid)`.execute(t));
  } catch (e) {
    return { error: dbMessage(e) };
  }
  refresh();
  redirect(`/college/students/import/${id.data}`);
}

export async function cancelImportAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await admin();
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: GENERIC_ERROR };
  try {
    await withSession(s, (t) => sql`SELECT students.cancel_import(${id.data}::uuid)`.execute(t));
  } catch (e) {
    return { error: dbMessage(e) };
  }
  refresh();
  redirect("/college/students/import");
}

// ───────────── student's own profile links (GitHub / LeetCode / LinkedIn) ─────────────
export async function updateOwnLinksAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await assertSameOrigin();
  const s = await requireRole("STUDENT");
  const values = { github: str(fd, "github", 300), leetcode: str(fd, "leetcode", 300), linkedin: str(fd, "linkedin", 300) };
  const r = ownLinksSchema.safeParse(values);
  if (!r.success) return { error: "Please correct the highlighted fields.", fieldErrors: firstErrors(r.error), values };
  try {
    await withSession(s, (t) => sql`SELECT students.update_own_links(${r.data.github ?? null}, ${r.data.leetcode ?? null}, ${r.data.linkedin ?? null})`.execute(t));
  } catch (e) {
    return { error: dbMessage(e), values };
  }
  revalidatePath("/student", "layout"); revalidatePath("/placement", "layout"); revalidatePath("/coordinator", "layout"); revalidatePath("/college", "layout");
  return { ok: "Profile links saved.", values };
}

// ───────────── student's own contact details ─────────────
export async function updateOwnContactAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await assertSameOrigin();
  const s = await requireRole("STUDENT");
  const values = { phone: str(fd, "phone", 40), personalEmail: str(fd, "personalEmail", 300) };
  const r = ownContactSchema.safeParse(values);
  if (!r.success) return { error: "Please correct the highlighted fields.", fieldErrors: firstErrors(r.error), values };
  try {
    await withSession(s, (t) => sql`SELECT students.update_own_contact(${r.data.phone ?? null}, ${r.data.personalEmail ?? null})`.execute(t));
  } catch (e) {
    return { error: dbMessage(e), values };
  }
  revalidatePath("/student", "layout");
  return { ok: "Contact details saved.", values };
}

