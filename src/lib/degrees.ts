/** The degrees a college offers. Its own module so validation and student code can both use it without importing each other. */
export const DEGREES = ["B.E.", "B.Tech", "M.E.", "M.Tech", "MCA", "MBA", "B.Sc", "M.Sc", "Diploma", "Other"] as const;
export type Degree = (typeof DEGREES)[number];
