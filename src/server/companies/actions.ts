"use server";

import { sql } from "kysely";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { COMPANY_FIELDS, companyFormSchema } from "@/lib/companies";
import { uuidSchema } from "@/lib/validation";
import { dbMessage, firstErrors, GENERIC_ERROR, str, type ActionState } from "../action-utils";
import { assertSameOrigin } from "../auth/request";
import { requireRole, withSession } from "../auth/session";

async function officer() {
  await assertSameOrigin();
  return requireRole("PLACEMENT_OFFICER");
}
const refresh = () => revalidatePath("/placement", "layout");
const read = (fd: FormData) => Object.fromEntries(COMPANY_FIELDS.map((k) => [k, str(fd, k, k === "description" ? 2400 : 400)]));

export async function createCompanyAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await officer();
  const values = read(fd);
  const r = companyFormSchema.safeParse(values);
  if (!r.success) return { error: "Please correct the highlighted fields.", fieldErrors: firstErrors(r.error), values };
  const v = r.data;
  let id = "";
  try {
    id = await withSession(s, async (t) => (await sql<{ id: string }>`SELECT placement.create_company(${v.name}, ${v.website ?? null}, ${v.industry ?? null}, ${v.description ?? null}, ${v.contactPerson ?? null}, ${v.contactEmail ?? null}, ${v.contactPhone ?? null}, ${v.location ?? null}) AS id`.execute(t)).rows[0].id);
  } catch (e) {
    return { error: dbMessage(e), values };
  }
  refresh();
  redirect(`/placement/companies/${id}?created=1`);
}

export async function updateCompanyAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await officer();
  const id = uuidSchema.safeParse(str(fd, "id"));
  const values = read(fd);
  const r = companyFormSchema.safeParse(values);
  if (!id.success) return { error: GENERIC_ERROR };
  if (!r.success) return { error: "Please correct the highlighted fields.", fieldErrors: firstErrors(r.error), values };
  const v = r.data;
  try {
    await withSession(s, (t) => sql`SELECT placement.update_company(${id.data}::uuid, ${v.name}, ${v.website ?? null}, ${v.industry ?? null}, ${v.description ?? null}, ${v.contactPerson ?? null}, ${v.contactEmail ?? null}, ${v.contactPhone ?? null}, ${v.location ?? null})`.execute(t));
  } catch (e) {
    return { error: dbMessage(e), values };
  }
  refresh();
  return { ok: "Company saved.", values };
}

export async function setCompanyStatusAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await officer();
  const id = uuidSchema.safeParse(str(fd, "id"));
  const status = z.enum(["ACTIVE", "INACTIVE"]).safeParse(str(fd, "status"));
  if (!id.success || !status.success) return { error: GENERIC_ERROR };
  try {
    await withSession(s, (t) => sql`SELECT placement.set_company_status(${id.data}::uuid, ${status.data})`.execute(t));
  } catch (e) {
    return { error: dbMessage(e) };
  }
  refresh();
  return { ok: status.data === "INACTIVE" ? "Company deactivated." : "Company reactivated." };
}
