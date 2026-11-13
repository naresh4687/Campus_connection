/** States and union territories of India (used to validate the college application form). */
export const INDIAN_STATES = [
  "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chandigarh", "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir",
  "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya",
  "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura",
  "Uttar Pradesh", "Uttarakhand", "West Bengal",
] as const;

export const COLLEGE_TYPES = [
  { value: "GOVERNMENT", label: "Government" },
  { value: "GOVERNMENT_AIDED", label: "Government-aided" },
  { value: "PRIVATE", label: "Private / self-financing" },
  { value: "DEEMED_UNIVERSITY", label: "Deemed university" },
  { value: "OTHER", label: "Other" },
] as const;
