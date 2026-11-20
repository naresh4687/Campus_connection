import { z } from "zod";
import { httpUrl } from "./validation";

export const ACHIEVEMENT_KINDS = ["CERTIFICATION", "HACKATHON", "INTERNSHIP", "PROJECT", "PUBLICATION", "OTHER"] as const;
export const KIND_LABEL: Record<string, string> = { CERTIFICATION: "Certification", HACKATHON: "Hackathon", INTERNSHIP: "Internship", PROJECT: "Project", PUBLICATION: "Publication", OTHER: "Other" };
export const ACHIEVEMENT_STATUS_LABEL: Record<string, string> = { SUBMITTED: "Awaiting review", VERIFIED: "Verified", REJECTED: "Returned", WITHDRAWN: "Withdrawn" };
export const ACHIEVEMENT_TONE: Record<string, string> = { SUBMITTED: "PENDING", VERIFIED: "APPROVED", REJECTED: "REJECTED", WITHDRAWN: "NOT_STARTED" };

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

/** The date must be a real calendar day, today or earlier (India time is close enough: the database checks again). */
const pastDate = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date it happened.").refine((v) => {
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v && v >= "2000-01-01" && v <= new Date(Date.now() + 14 * 3600_000).toISOString().slice(0, 10);
}, "Enter a real date between 2000 and today.");

export const achievementSchema = z.object({
  kind: z.enum(ACHIEVEMENT_KINDS, "Choose a type."),
  title: z.string().trim().min(3, "The title must be at least 3 characters.").max(150, "Keep the title under 150 characters."),
  date: pastDate,
  description: z.preprocess(blank, z.string().trim().max(600, "Keep the description under 600 characters.").optional()),
  link: z.preprocess(blank, httpUrl.max(300).optional()),
});
export type AchievementInput = z.infer<typeof achievementSchema>;

export type AchievementDetails = { kind: string; title: string; achieved_on: string; description: string | null; link: string | null };
export const DETAIL_FIELDS: { key: keyof AchievementDetails; label: string }[] = [
  { key: "kind", label: "Type" }, { key: "title", label: "Title" }, { key: "achieved_on", label: "Date" }, { key: "description", label: "Description" }, { key: "link", label: "Link" },
];
/** The fields whose value differs between the verified entry and its revision (null and empty are the same). */
export const changedFields = (before: AchievementDetails, after: AchievementDetails) =>
  DETAIL_FIELDS.filter((f) => (before[f.key] ?? "") !== (after[f.key] ?? "")).map((f) => f.key);
