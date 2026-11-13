import { z } from "zod";
import { emailField, httpUrl, phoneField } from "./validation";

const optional = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), schema.optional());

export const companyFormSchema = z.object({
  name: z.string().trim().min(2, "Enter the company name.").max(150),
  website: optional(httpUrl),
  industry: optional(z.string().trim().min(2, "At least 2 characters.").max(80)),
  description: optional(z.string().trim().max(2000, "Keep the description under 2000 characters.")),
  contactPerson: optional(z.string().trim().min(2, "At least 2 characters.").max(120)),
  contactEmail: optional(emailField),
  contactPhone: optional(phoneField),
  location: optional(z.string().trim().min(2, "At least 2 characters.").max(150)),
});
export type CompanyInput = z.infer<typeof companyFormSchema>;

export const COMPANY_FIELDS = ["name", "website", "industry", "description", "contactPerson", "contactEmail", "contactPhone", "location"] as const;
export const INDUSTRY_SUGGESTIONS = ["Information Technology", "Software Services", "Product / SaaS", "Core Engineering", "Manufacturing", "Automotive", "Electronics", "Telecom", "Banking & Finance", "Consulting", "E-commerce", "Education", "Healthcare"];
